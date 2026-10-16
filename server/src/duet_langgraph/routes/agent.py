"""导演 Agent 的 SSE 聊天通道（对齐 TS routes/agent.ts，历史持久化为 Python 版新增）。

POST /api/agent/chat  body: { sessionId, text, providerId, model, thinking?, chatId? }
→ SSE 事件流：delta / tool_call / tool_result / assistant / done / error

选 SSE 不选 WS：一问一答、请求作用域、客户端断开即 abort，无连接态管理。
带 chatId 的对话增量落盘（user / assistant / tool 展示条目），可经
GET /api/agent/chats、GET /api/agent/chats/{id}、DELETE /api/agent/chats/{id} 管理历史。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, ConfigDict, Field

from ..agent.messages import get_agent_session
from ..agent.prompt import build_director_agent_system_prompt
from ..agent.query import run_agent_query
from ..store import agent_chats
from ..store import providers as provider_store

logger = logging.getLogger(__name__)

router = APIRouter()


class AgentChatBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    session_id: str = Field(min_length=1, alias="sessionId")
    text: str = Field(min_length=1)
    provider_id: str = Field(min_length=1, alias="providerId")
    model: str = Field(min_length=1)
    thinking: str | None = None
    """带 chatId 即持久化：历史可经 /api/agent/chats 查看/续聊；缺省维持旧的纯内存行为"""
    chat_id: str | None = Field(default=None, min_length=1, alias="chatId")


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/api/agent/chats")
async def list_agent_chats() -> list[dict]:
    return agent_chats.list_chats()


@router.get("/api/agent/chats/{chat_id}")
async def get_agent_chat(chat_id: str):
    chat = agent_chats.get_chat(chat_id)
    if chat is None:
        return JSONResponse({"error": "历史会话不存在"}, status_code=404)
    return chat


@router.delete("/api/agent/chats/{chat_id}")
async def delete_agent_chat(chat_id: str):
    if not agent_chats.delete_chat(chat_id):
        return JSONResponse({"error": "历史会话不存在"}, status_code=404)
    return {"ok": True}


@router.post("/api/agent/chat")
async def agent_chat(body: AgentChatBody):
    prov = provider_store.get_provider(body.provider_id)
    if prov is None:
        return JSONResponse({"error": "Provider 不存在"}, status_code=404)

    # 会话消息（首条自动带系统提示词；带 chatId 且内存态已过期时从落盘历史重建上下文）
    messages = get_agent_session(body.session_id)
    if len(messages) == 0:
        messages.append(SystemMessage(content=build_director_agent_system_prompt()))
        if body.chat_id:
            messages.extend(agent_chats.history_messages(body.chat_id))
    messages.append(HumanMessage(content=body.text))

    # 落盘历史：user 立即写；assistant/tool 在对应事件到达时写
    if body.chat_id:
        agent_chats.append_message(body.chat_id, "user", content=body.text)

    # body.model 覆盖 Provider 的模型（对齐 TS：conn.model = body.model）
    provider = prov.model_copy(update={"model": body.model})
    abort = asyncio.Event()

    async def stream():
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        # 落盘历史：tool_call 先暂存（含参数与摘要），配对的 tool_result 到达时合并成一条写盘
        pending_tools: list[dict] = []

        def persist_event(etype: str, e: dict) -> None:
            if body.chat_id is None:
                return
            if etype == "tool_call":
                pending_tools.append(
                    {"name": e["name"], "args": e["args"], "summary": e["summary"]}
                )
            elif etype == "tool_result":
                pending = next((p for p in pending_tools if p["name"] == e["name"]), None)
                if pending is not None:
                    pending_tools.remove(pending)
                agent_chats.append_message(
                    body.chat_id,
                    "tool",
                    name=e["name"],
                    summary=(pending or {}).get("summary", e["summary"]),
                    args=(pending or {}).get("args", {}),
                    ok=e["ok"],
                    resultSummary=e["summary"],
                    mutated=e["mutated"],
                )
            elif etype == "assistant":
                agent_chats.append_message(body.chat_id, "assistant", content=e["content"])

        def on_event(e: dict) -> None:
            etype = e.get("type")
            if etype == "delta":
                data = {"text": e["text"]}
            elif etype == "tool_call":
                data = {"name": e["name"], "args": e["args"], "summary": e["summary"]}
            elif etype == "tool_result":
                data = {
                    "name": e["name"],
                    "ok": e["ok"],
                    "summary": e["summary"],
                    "mutated": e["mutated"],
                }
            elif etype == "assistant":
                data = {"content": e["content"]}
            elif etype == "done":
                data = {"reason": e["reason"]}
            else:  # pragma: no cover
                return
            persist_event(etype, e)
            queue.put_nowait(_sse(etype, data))

        async def runner():
            try:
                final = await run_agent_query(
                    messages=messages,
                    provider=provider,
                    thinking=body.thinking or None,
                    on_event=on_event,
                    abort=abort,
                )
                messages[:] = final  # 写回会话态
            except Exception as e:  # noqa: BLE001 —— LLM 失败不自动重试，surfaced 给用户重发
                logger.warning("[agent] 查询失败: %s", e)
                queue.put_nowait(_sse("error", {"message": str(e)}))
                queue.put_nowait(_sse("done", {"reason": "error"}))
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            # 客户端断开（生成器被取消）或正常结束 → 停止 Agent 循环
            abort.set()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
