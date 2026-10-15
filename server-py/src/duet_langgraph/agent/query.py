"""Agent 循环（对齐 TS agent/query.ts + tool-execution.ts）。

LangGraph StateGraph 形态：agent_step（LLM 流式调用，检查停止/轮次阀）⇄
tool_step（顺序执行工具批次回灌），无 checkpointer——会话态由调用方
（agent/messages.py）持有，每次 ainvoke 传入全量消息，结束后整体写回。

事件（对齐 TS AgentLoopEvent）经 ContextVar 回调发出：
delta / assistant / tool_call / tool_result / done(completed|turn_limit|aborted)。
任何工具层失败都不抛出循环，作为 ToolMessage 回灌给模型自纠。
"""

from __future__ import annotations

import asyncio
import logging
import operator
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AnyMessage, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, ValidationError

from ..ai.models import make_model
from ..schemas import Provider
from .tools import AGENT_TOOL_SCHEMAS, AGENT_TOOLS

logger = logging.getLogger(__name__)

AGENT_MAX_TURNS = 30
RECURSION_LIMIT = 200  # 30 轮 × 2 节点 + 余量

AgentEvent = dict[str, Any]
EventFn = Callable[[AgentEvent], None]

_events_ctx: ContextVar[EventFn | None] = ContextVar("duet_agent_events", default=None)


@dataclass
class AgentRuntime:
    provider: Provider
    thinking: str | None = None
    abort: asyncio.Event | None = None


_runtime_ctx: ContextVar[AgentRuntime | None] = ContextVar("duet_agent_runtime", default=None)


class AgentState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    turns: int
    done_reason: str | None


def _emit(event: AgentEvent) -> None:
    fn = _events_ctx.get()
    if fn is not None:
        fn(event)


def _chunk_text(chunk: Any) -> str:
    content = chunk.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


async def agent_step(state: AgentState) -> dict[str, Any]:
    rt = _runtime_ctx.get()
    assert rt is not None
    turns = state.get("turns", 0)

    # 每个 step 开始前检查停止（上一批工具执行完后的边界）
    if rt.abort is not None and rt.abort.is_set():
        _emit({"type": "done", "reason": "aborted"})
        return {"done_reason": "aborted"}
    if turns >= AGENT_MAX_TURNS:
        _emit({"type": "done", "reason": "turn_limit"})
        return {"done_reason": "turn_limit"}

    model = make_model(
        provider=rt.provider, temperature=0.7, max_tokens=1024, thinking=rt.thinking
    ).bind_tools(AGENT_TOOL_SCHEMAS)

    chunks: list[Any] = []
    async for chunk in model.astream(state["messages"]):
        piece = _chunk_text(chunk)
        if piece:
            _emit({"type": "delta", "text": piece})
        chunks.append(chunk)

    full = chunks[0]
    for c in chunks[1:]:
        full = operator.add(full, c)  # AIMessage 合并：content 拼接 + tool_call_chunks 聚合

    # 无工具调用 → 本轮任务收尾
    if not full.tool_calls:
        _emit({"type": "assistant", "content": _chunk_text(full)})
        _emit({"type": "done", "reason": "completed"})
        return {"messages": [full], "turns": turns + 1, "done_reason": "completed"}

    return {"messages": [full], "turns": turns + 1}


def route_after_agent(state: AgentState) -> str:
    return END if state.get("done_reason") else "tool_step"


async def tool_step(state: AgentState) -> dict[str, Any]:
    rt = _runtime_ctx.get()
    assert rt is not None
    assert state["messages"]
    last = state["messages"][-1]
    new_messages: list[AnyMessage] = []

    # 顺序执行工具批次，逐个回灌（批次内每个调用都补 tool result，序列恒合法）
    for call in last.tool_calls:
        name = call.get("name") or ""
        call_id = call.get("id") or ""
        raw_args: dict[str, Any] = call.get("args") or {}
        tool = AGENT_TOOLS.get(name)

        if rt.abort is not None and rt.abort.is_set():
            new_messages.append(
                ToolMessage(content="已因用户停止而跳过该工具", tool_call_id=call_id, name=name)
            )
            continue

        if tool is None:
            text = f"未知工具：{name}。可用工具：{'、'.join(AGENT_TOOLS)}。"
            _emit(
                {
                    "type": "tool_call",
                    "name": name,
                    "args": raw_args,
                    "summary": f"调用未知工具 {name}",
                }
            )
            _emit(
                {
                    "type": "tool_result",
                    "name": name,
                    "ok": False,
                    "summary": text,
                    "mutated": False,
                }
            )
            new_messages.append(ToolMessage(content=text, tool_call_id=call_id, name=name))
            continue

        try:
            args: BaseModel = tool.args_schema.model_validate(raw_args)
        except ValidationError as e:
            detail = "；".join(
                f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()
            )
            text = f"参数校验失败：{detail}"
            _emit(
                {
                    "type": "tool_call",
                    "name": name,
                    "args": raw_args,
                    "summary": "参数校验失败",
                }
            )
            _emit(
                {
                    "type": "tool_result",
                    "name": name,
                    "ok": False,
                    "summary": text,
                    "mutated": False,
                }
            )
            new_messages.append(ToolMessage(content=text, tool_call_id=call_id, name=name))
            continue

        _emit(
            {
                "type": "tool_call",
                "name": name,
                "args": raw_args,
                "summary": tool.summarize(args),
            }
        )
        try:
            text = await tool.run(args)
            _emit(
                {
                    "type": "tool_result",
                    "name": name,
                    "ok": True,
                    "summary": text.strip(),
                    "mutated": tool.is_write,
                }
            )
        except Exception as e:  # noqa: BLE001 —— 失败回灌给模型自纠，不崩循环
            text = f"执行失败：{e}"
            _emit(
                {
                    "type": "tool_result",
                    "name": name,
                    "ok": False,
                    "summary": text,
                    "mutated": False,
                }
            )
        new_messages.append(ToolMessage(content=text, tool_call_id=call_id, name=name))

    return {"messages": new_messages}


_compiled: Any | None = None


def _get_graph():
    global _compiled
    if _compiled is None:
        builder = StateGraph(AgentState)
        builder.add_node("agent_step", agent_step)
        builder.add_node("tool_step", tool_step)
        builder.add_edge(START, "agent_step")
        builder.add_conditional_edges(
            "agent_step", route_after_agent, {END: END, "tool_step": "tool_step"}
        )
        builder.add_edge("tool_step", "agent_step")
        _compiled = builder.compile()
    return _compiled


async def run_agent_query(
    *,
    messages: list[AnyMessage],
    provider: Provider,
    thinking: str | None,
    on_event: EventFn,
    abort: asyncio.Event | None,
) -> list[AnyMessage]:
    """跑一轮 Agent 循环，返回最终消息列表（调用方写回会话态）。"""
    t_ev = _events_ctx.set(on_event)
    t_rt = _runtime_ctx.set(AgentRuntime(provider=provider, thinking=thinking, abort=abort))
    try:
        final = await _get_graph().ainvoke(
            {"messages": messages, "turns": 0, "done_reason": None},
            config={"recursion_limit": RECURSION_LIMIT},
        )
        return final["messages"]
    finally:
        _events_ctx.reset(t_ev)
        _runtime_ctx.reset(t_rt)


def _reset_for_test() -> None:
    global _compiled
    _compiled = None
