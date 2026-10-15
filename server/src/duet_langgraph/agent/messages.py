"""Agent 会话态：内存 Map + 空闲过期清理（对齐 TS agent/messages.ts）。

决策记录（同 TS）：聊天历史不持久化——刷新页面换新 sessionId 即全新会话；
服务端只保留最近活跃会话的内存态（TTL 2 小时，惰性清理）。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from langchain_core.messages import AnyMessage

SESSION_TTL_MS = 2 * 60 * 60 * 1000


@dataclass
class _AgentSession:
    messages: list[AnyMessage] = field(default_factory=list)
    last_used: int = 0


_sessions: dict[str, _AgentSession] = {}


def _sweep() -> None:
    now = int(time.time() * 1000)
    for sid in [k for k, s in _sessions.items() if now - s.last_used > SESSION_TTL_MS]:
        del _sessions[sid]


def get_agent_session(id_: str) -> list[AnyMessage]:
    """取会话消息列表（不存在则创建）；调用即续期。"""
    _sweep()
    s = _sessions.get(id_)
    if s is None:
        s = _AgentSession(last_used=int(time.time() * 1000))
        _sessions[id_] = s
    s.last_used = int(time.time() * 1000)
    return s.messages


def agent_session_count() -> int:
    _sweep()
    return len(_sessions)


def _reset_for_test() -> None:
    _sessions.clear()
