"""WS 端点 /ws/chat + 主循环驱动 run_loop（对齐 TS wsRoutes.ts / chatHandler.ts）。"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..graph.chat_graph import get_compiled_graph
from ..graph.nodes import RECURSION_LIMIT
from ..graph.state import CharacterLoopInfo, LoopRuntime, broadcast_ctx, loop_ctx
from ..routes.exchange import fetch_rates
from ..schemas import Session, dump_session, now_ms
from ..store import providers as provider_store
from ..store import session_store
from ..utils.cost import CostRates
from ..utils.currency import get_rates_with_fallback, pick_display_currency
from . import runtime as ws_runtime

logger = logging.getLogger(__name__)

router = APIRouter()


class OutboundQueue:
    """每连接出站队列：保证事件严格有序（广播可能来自图任务与 REST 任务两个源）。"""

    def __init__(self, websocket: WebSocket):
        self._ws = websocket
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._sender())

    async def _sender(self) -> None:
        while True:
            text = await self._queue.get()
            if text is None:
                break
            with contextlib.suppress(Exception):
                await self._ws.send_text(text)

    def send(self, msg: dict[str, Any]) -> None:
        self._queue.put_nowait(json.dumps(msg, ensure_ascii=False))

    async def stop(self) -> None:
        self._queue.put_nowait(None)  # type: ignore[arg-type]
        if self._task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await self._task


@router.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    await websocket.accept()
    session_id = websocket.query_params.get("sessionId")
    if not session_id:
        await websocket.send_text(json.dumps({"type": "error", "message": "缺少 sessionId"}))
        await websocket.close()
        return

    out = OutboundQueue(websocket)
    out.start()
    send = out.send
    detach = ws_runtime.attach_client(session_id, send)

    try:
        session = session_store.load_session(session_id)
        if session is not None:
            send({"type": "sync", "session": dump_session(session)})
        else:
            send({"type": "error", "message": "会话不存在"})

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                if not isinstance(msg, dict):
                    raise TypeError("非对象")
            except (json.JSONDecodeError, TypeError):
                send({"type": "error", "message": "消息格式错误"})
                continue

            mtype = msg.get("type")
            if mtype == "ping":
                send({"type": "pong"})
            elif mtype == "start":
                s = session_store.load_session(session_id)
                if s is None:
                    send({"type": "error", "message": "会话不存在"})
                    continue
                task = asyncio.create_task(
                    run_loop(
                        s, max_rounds=msg.get("maxRounds"), duration_sec=msg.get("durationSec")
                    )
                )
                task.add_done_callback(lambda t: _report_loop_error(t, send))
            elif mtype == "stop":
                ws_runtime.stop_session(session_id)
            elif mtype == "reading":
                ws_runtime.update_reading_state(
                    session_id, bool(msg.get("atBottom")), int(msg.get("bufferedRounds") or 0)
                )
            else:
                send({"type": "error", "message": f"未知消息类型: {mtype}"})
    except WebSocketDisconnect:
        pass
    finally:
        detach()
        await out.stop()


def _report_loop_error(task: asyncio.Task, send) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.exception("run_loop 异常", exc_info=exc)
        with contextlib.suppress(Exception):
            send({"type": "error", "message": f"运行异常: {exc}"})


def _provider_id_of(session: Session, character_id: str) -> str | None:
    config = session.config
    if character_id == "A":
        return config.provider_a
    if character_id == "B":
        return config.provider_b
    if character_id == "C":
        return config.provider_c
    return (config.character_providers or {}).get(character_id)


def _thinking_of(session: Session, character_id: str) -> str | None:
    config = session.config
    if character_id == "A":
        return config.thinking_a
    if character_id == "B":
        return config.thinking_b
    if character_id == "C":
        return config.thinking_c
    return (config.character_thinking or {}).get(character_id)


async def run_loop(
    session: Session,
    max_rounds: int | None = None,
    duration_sec: int | None = None,
) -> None:
    """主循环驱动：解析运行时依赖 → 注入上下文 → 跑图（状态每轮写穿 sessions_meta）。"""
    rt = ws_runtime.get_runtime(session.id)
    if rt.running:
        ws_runtime.broadcast(session.id, {"type": "error", "message": "会话已在运行中"})
        return
    if session.status not in ("idle", "stopped", "finished", "error"):
        ws_runtime.broadcast(
            session.id, {"type": "error", "message": f"当前状态 {session.status} 不可启动"}
        )
        return

    was_idle = session.status == "idle"
    if max_rounds is not None:
        session.config.max_rounds = max_rounds
    if duration_sec is not None:
        session.config.duration_sec = duration_sec

    rt.running = True
    rt.stop_requested = False
    rt.stop_phase = "idle"
    rt.active_session = session
    session.status = "running"
    session.error = None
    session.finished_reason = None

    # 计时重置：全新启动设初始时间；继续时重置（暂停期间不计入时长熔断）
    if was_idle:
        if not session.started_at:
            session.started_at = now_ms()
    else:
        session.started_at = now_ms()
        session.stopped_at = None

    session_store.save_session(session)
    ws_runtime.broadcast(session.id, {"type": "started", "startedAt": session.started_at})

    # 每角色解析 Provider 连接 + 单价
    loop_runtime = LoopRuntime(session_id=session.id)
    for a in session.characters:
        prov = provider_store.resolve_provider(_provider_id_of(session, a.id))
        if prov is None:
            ws_runtime.broadcast(
                session.id,
                {"type": "error", "message": "无可用的 Provider。请在设置中配置至少一个模型连接。"},
            )
            session.status = "error"
            session.error = "无可用的 Provider"
            session.finished_reason = "error"
            session_store.save_session(session)
            rt.running = False
            rt.active_session = None
            return
        loop_runtime.characters[a.id] = CharacterLoopInfo(
            character_id=a.id,
            name=a.name,
            provider=prov,
            rates=CostRates(
                currency=prov.pricing.currency,
                input_per_m_tok=prov.pricing.input_per_m_tok,
                output_per_m_tok=prov.pricing.output_per_m_tok,
                cache_hit_enabled=prov.pricing.cache_hit_enabled,
                cache_hit_per_m_tok=prov.pricing.cache_hit_per_m_tok,
                cache_write_enabled=prov.pricing.cache_write_enabled,
                cache_write_per_m_tok=prov.pricing.cache_write_per_m_tok,
            ),
            thinking=_thinking_of(session, a.id),
        )

    # 展示货币选举 + 汇率（失败走固定兜底）
    loop_runtime.display_currency = pick_display_currency(
        [c.rates.currency for c in loop_runtime.characters.values()]
    )
    loop_runtime.exchange_rates = await get_rates_with_fallback(fetch_rates)

    # 组装初始 state（每次运行都从最新 session 出发；图 checkpoint 承载运行中断点）
    initial_state = {
        "session": dump_session(session),
        "memories": {
            cid: data.model_dump(by_alias=True, exclude_none=True)
            for cid, data in session.memory.items()
        },
        "current_speaker": session.current_character_id,
        "round": session_store.current_round(session),
        "stop_reason": None,
        "messages": [],
    }

    token_loop = loop_ctx.set(loop_runtime)
    token_bc = broadcast_ctx.set(lambda msg: ws_runtime.broadcast(session.id, msg))
    try:
        graph = await get_compiled_graph()
        await graph.ainvoke(
            initial_state,
            config={
                "configurable": {"thread_id": session.id},
                "recursion_limit": RECURSION_LIMIT,
            },
        )
    finally:
        loop_ctx.reset(token_loop)
        broadcast_ctx.reset(token_bc)
        rt.running = False
        rt.active_session = None
        rt.stop_requested = False
        rt.stop_phase = "idle"
