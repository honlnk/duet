"""导演 Agent 的 SSE 聊天通道（对齐 TS routes/agent.ts）。

POST /api/agent/chat  body: { sessionId, text, providerId, model, thinking? }
→ SSE 事件流：delta / tool_call / tool_result / assistant / done / error

选 SSE 不选 WS：一问一答、请求作用域、客户端断开即 abort，无连接态管理。
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


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/api/agent/chat")
async def agent_chat(body: AgentChatBody):
    prov = provider_store.get_provider(body.provider_id)
    if prov is None:
        return JSONResponse({"error": "Provider 不存在"}, status_code=404)

    # 会话消息（首条自动带系统提示词）
    messages = get_agent_session(body.session_id)
    if len(messages) == 0:
        messages.append(SystemMessage(content=build_director_agent_system_prompt()))
    messages.append(HumanMessage(content=body.text))

    # body.model 覆盖 Provider 的模型（对齐 TS：conn.model = body.model）
    provider = prov.model_copy(update={"model": body.model})
    abort = asyncio.Event()

    async def stream():
        queue: asyncio.Queue[str | None] = asyncio.Queue()

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
