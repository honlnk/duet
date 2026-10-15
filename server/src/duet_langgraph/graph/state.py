"""图状态与运行时上下文。

State 设计落定（记入施工日志）：
- `session` 携带全量会话 JSON（运行时真相源），每轮 post_reply 写穿 sessions_meta；
  memories 独立字段承载每角色记忆（CharacterMemoryData JSON 形态）。
- sketch 中的 `messages: Annotated[list, add_messages]` 落地为普通 list：
  展示层消息是 TS PersistedMessage 契约（role/content/ts/tokens/truncated），
  add_messages 的 langchain 消息格式转换会破坏该契约，故不用 reducer。
- 运行期非序列化信息（每角色 Provider 连接、汇率、广播函数）不进 state
  （checkpointer 需要可序列化），经 ContextVar 注入。
"""

from __future__ import annotations

from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, TypedDict

from ..schemas import Provider
from ..utils.cost import CostRates


class DuetState(TypedDict, total=False):
    session: dict[str, Any]  # 全量会话 JSON
    memories: dict[str, dict[str, Any]]  # characterId → CharacterMemoryData JSON
    current_speaker: str | None
    round: int
    stop_reason: str | None
    messages: list[dict[str, Any]]  # 展示层消息流（PersistedMessage JSON，镜像 session.messages）
    pending_messages: list[dict[str, str]]  # build_context 产物 → character_reply 输入
    reply: dict[str, Any] | None  # character_reply 产物（content + usage）
    usage: dict[str, float] | None  # 本轮增量 usage（stats 累计在 session.stats）


@dataclass
class CharacterLoopInfo:
    """每角色的运行期连接信息（运行时解析一次，不进 checkpoint）。"""

    character_id: str
    name: str
    provider: Provider
    rates: CostRates
    thinking: str | None = None


@dataclass
class LoopRuntime:
    session_id: str
    characters: dict[str, CharacterLoopInfo] = field(default_factory=dict)
    display_currency: str = "CNY"
    exchange_rates: dict[str, float] = field(default_factory=dict)


loop_ctx: ContextVar[LoopRuntime | None] = ContextVar("duet_loop_ctx", default=None)
broadcast_ctx: ContextVar[Callable[[dict[str, Any]], None] | None] = ContextVar(
    "duet_broadcast", default=None
)


def broadcast_event(msg: dict[str, Any]) -> None:
    """从图节点向外广播 WS 事件（未设置广播函数时静默丢弃，单测可注入捕获）。"""
    fn = broadcast_ctx.get()
    if fn is not None:
        fn(msg)
