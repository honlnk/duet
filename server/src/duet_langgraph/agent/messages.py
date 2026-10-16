"""Agent 会话态：内存 Map + 空闲过期清理（对齐 TS agent/messages.ts）。

历史决策（同 TS）曾是「聊天历史不持久化」；现已按需求改为持久化
（store/agent_chats.py 落盘展示条目），本模块继续承担「活跃会话的模型上下文」
——含工具消息的全量消息序列，TTL 2 小时惰性清理；过期后带 chatId 再来
会从落盘历史重建文本上下文（见 routes/agent.py）。
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
