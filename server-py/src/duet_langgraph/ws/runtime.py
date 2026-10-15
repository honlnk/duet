"""WS 会话运行时注册表（对齐 TS ws/chatHandler 的 Runtime 部分）。

S1 阶段：仅承载客户端注册与广播（REST 路由的 director_added/removed 事件用）。
S2 阶段：主对话图循环挂到同一注册表上（running/stop 标志等届时扩展）。
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

SendFn = Callable[[dict[str, Any]], None]


@dataclass
class Runtime:
    ws_clients: set[SendFn] = field(default_factory=set)
    running: bool = False
    stop_requested: bool = False
    stop_phase: str = "idle"
    user_at_bottom: bool = True
    user_buffered_rounds: int = 0
    # S2：主循环持有的会话内存态引用与中止句柄
    active_session: Any = None
    abort_event: asyncio.Event | None = None


_runtimes: dict[str, Runtime] = {}


def get_runtime(session_id: str) -> Runtime:
    rt = _runtimes.get(session_id)
    if rt is None:
        rt = Runtime()
        _runtimes[session_id] = rt
    return rt


def attach_client(session_id: str, send: SendFn) -> Callable[[], None]:
    rt = get_runtime(session_id)
    rt.ws_clients.add(send)

    def detach() -> None:
        rt.ws_clients.discard(send)

    return detach


def broadcast(session_id: str, msg: dict[str, Any]) -> None:
    rt = _runtimes.get(session_id)
    if rt is None:
        return
    for send in list(rt.ws_clients):
        try:
            send(msg)
        except Exception:
            rt.ws_clients.discard(send)


def sync_relationships_to_runtime(session_id: str, relationships: dict[str, str]) -> None:
    rt = _runtimes.get(session_id)
    if rt is not None and rt.active_session is not None:
        rt.active_session.relationships = relationships


def sync_directors_to_runtime(session_id: str, directors: list[Any]) -> None:
    rt = _runtimes.get(session_id)
    if rt is not None and rt.active_session is not None:
        rt.active_session.directors = directors


def sync_config_to_runtime(session_id: str, config: dict[str, Any]) -> None:
    rt = _runtimes.get(session_id)
    if rt is not None and rt.active_session is not None:
        for key, value in config.items():
            setattr(rt.active_session.config, key, value)


def update_reading_state(session_id: str, at_bottom: bool, buffered_rounds: int) -> None:
    rt = _runtimes.get(session_id)
    if rt is None:
        return
    rt.user_at_bottom = at_bottom
    rt.user_buffered_rounds = buffered_rounds


def stop_session(session_id: str) -> None:
    """用户主动暂停：设标志，不中断当前请求；广播 stopping。"""
    rt = get_runtime(session_id)
    rt.stop_requested = True
    rt.stop_phase = "pending"
    if rt.abort_event is not None:
        # 与 TS 不同点：TS 的 stop 不 abort（等当前发言完成）；此事件留给 S2 的
        # 循环在轮间隙检查。此处不 set。
        pass
    broadcast(session_id, {"type": "stopping"})
