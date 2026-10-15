"""契约模型层：TS 版 server/src/types/index.ts 的 pydantic v2 翻译。

所有对外字段的序列化名恒为 camelCase（与 TS 契约逐字段对齐）：
- 入参解析：populate_by_name（camelCase 与 snake_case 都可接受）
- 出参序列化：model_dump(by_alias=True)

两类可选字段的序列化约定（与 TS JSON.stringify 行为一致）：
- omittable：值为 None 时整个键省略（如 description、scenario、thinkingConfig）
- nullable：值恒序列化，无值时为 null（如 finishedReason、startedAt、stoppedAt、error）
  由 dump_model() 的 nullable 参数控制，不依赖 pydantic 全局开关。
"""

from __future__ import annotations

import random
import string
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

ApiProtocol = Literal["openai", "openai-responses", "anthropic", "gemini"]
SessionStatus = Literal["idle", "running", "stopped", "finished", "error"]
CharacterId = Literal["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

ALL_CHARACTER_IDS: tuple[str, ...] = ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J")
MIN_CHARACTERS = 2
MAX_CHARACTERS = 10

PRESET_COLORS = ("blue", "pink", "green", "amber", "purple", "teal")
DEFAULT_CHARACTER_COLORS = ("blue", "pink", "green", "amber", "purple", "teal")


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


def dump_model(model: BaseModel, *, nullable: frozenset[str] = frozenset()) -> dict[str, Any]:
    """序列化：None 键省略；nullable 集合内的字段 None 时保留为 null。"""
    data = model.model_dump(by_alias=True, exclude_none=True)
    for name in nullable:
        if name not in type(model).model_fields:
            continue
        alias = to_camel(name)
        if getattr(model, name) is None and alias not in data:
            data[alias] = None
    return data


def gen_id() -> str:
    """与 TS genId 同构：8 位随机 base36 + 时间戳 base36 尾 4 位。"""
    alphabet = string.digits + string.ascii_lowercase
    rand = "".join(random.choices(alphabet, k=8))
    ts = ""
    n = int(time.time() * 1000)
    digits = []
    while n:
        digits.append(alphabet[n % 36])
        n //= 36
    ts = "".join(reversed(digits))[-4:]
    return rand + ts


def now_ms() -> int:
    return int(time.time() * 1000)


# ============================== Provider ==============================


class ProviderPricing(CamelModel):
    currency: str = "CNY"
    input_per_m_tok: float
    output_per_m_tok: float
    cache_hit_enabled: bool = True
    cache_hit_per_m_tok: float
    cache_write_enabled: bool = False
    cache_write_per_m_tok: float = 0


class Provider(CamelModel):
    id: str
    name: str
    base_url: str
    api_key: str
    model: str
    protocol: ApiProtocol = "openai"
    pricing: ProviderPricing
    thinking_config: dict[str, Any] | None = None


class ProviderListItem(CamelModel):
    id: str
    name: str
    base_url: str
    model: str
    protocol: ApiProtocol
    pricing: ProviderPricing
    thinking_config: dict[str, Any] | None = None
    api_key_masked: str


class ProviderFormData(CamelModel):
    name: str
    base_url: str
    api_key: str
    model: str
    protocol: ApiProtocol | None = None
    pricing: dict[str, Any] | None = None
    thinking_config: dict[str, Any] | None = None


# ============================== 资产库 ==============================


class CharacterTemplate(CamelModel):
    id: str
    name: str
    description: str = ""
    personality: str = ""
    created_at: int


class TopicTemplate(CamelModel):
    id: str
    content: str
    created_at: int


class WorldviewTemplate(CamelModel):
    id: str
    name: str
    scenario: str = ""
    created_at: int


class NodePosition(CamelModel):
    x: float
    y: float


class LibraryData(CamelModel):
    character_templates: list[CharacterTemplate] = Field(default_factory=list)
    topic_templates: list[TopicTemplate] = Field(default_factory=list)
    worldview_templates: list[WorldviewTemplate] = Field(default_factory=list)
    relationships: dict[str, str] = Field(default_factory=dict)
    node_positions: dict[str, NodePosition] = Field(default_factory=dict)


class LibraryImportPayload(CamelModel):
    character_templates: list[dict[str, Any]] | None = None
    topic_templates: list[dict[str, Any]] | None = None
    worldview_templates: list[dict[str, Any]] | None = None
    relationships: dict[str, str] | None = None
    node_positions: dict[str, dict[str, float]] | None = None


# ============================== 会话 ==============================


class CharacterRef(CamelModel):
    id: CharacterId
    name: str
    description: str | None = None
    personality: str | None = None
    color: str | None = None


class DirectorInstruction(CamelModel):
    id: str
    content: str
    added_at: int
    added_round: int
    duration_rounds: int = 0


class MemoryMessage(CamelModel):
    role: Literal["user", "assistant"]
    content: str


class CharacterMemoryData(CamelModel):
    character: CharacterRef
    others: list[CharacterRef] = Field(default_factory=list)
    topic: str
    messages: list[MemoryMessage] = Field(default_factory=list)
    summary: str = ""
    last_summarized_round: int = 0
    relationships: dict[str, str] | None = None


class TokenUsage(CamelModel):
    prompt: int = 0
    completion: int = 0


class PersistedMessage(CamelModel):
    character_id: CharacterId
    role: Literal["assistant"] = "assistant"
    content: str
    ts: int
    tokens: TokenUsage
    truncated: bool = False


class SessionConfig(CamelModel):
    max_rounds: int = 0
    duration_sec: int = 0
    model: str = "deepseek-v4-flash"
    temperature: float = 0.7
    summary_every_n: int = 10
    keep_recent: int = 8
    provider_a: str | None = None
    provider_b: str | None = None
    provider_c: str | None = None
    character_providers: dict[str, str] | None = None
    thinking_a: str | None = None
    thinking_b: str | None = None
    thinking_c: str | None = None
    character_thinking: dict[str, str] | None = None
    scenario: str | None = None
    pacing_enabled: bool | None = None
    pacing_buffer_rounds: int | None = None
    # D3 新增（TS 无）：发言者调度；None/round-robin = 轮转（默认），llm = 模型选人
    scheduling: str | None = None


class SessionStats(CamelModel):
    total_prompt_tokens: int = 0
    total_completion_tokens: int = 0
    total_tokens: int = 0
    total_cache_hit_tokens: int = 0
    total_cache_miss_tokens: int = 0
    total_cache_write_tokens: int = 0
    est_cost: float = 0
    cost_currency: str = ""
    total_chars: int = 0


class Session(CamelModel):
    id: str
    topic: str
    characters: list[CharacterRef]
    config: SessionConfig
    status: SessionStatus
    finished_reason: str | None = None
    started_at: int | None = None
    stopped_at: int | None = None
    message_count: int
    current_character_id: CharacterId
    messages: list[PersistedMessage]
    memory: dict[str, CharacterMemoryData]
    stats: SessionStats
    error: str | None = None
    created_at: int
    updated_at: int
    relationships: dict[str, str] | None = None
    node_positions: dict[str, NodePosition] | None = None
    directors: list[DirectorInstruction] = Field(default_factory=list)


SESSION_NULLABLE = frozenset({"finished_reason", "started_at", "stopped_at", "error"})


def dump_session(session: Session) -> dict[str, Any]:
    """Session 序列化：四个状态字段恒出现（无值为 null），其余 None 省略。"""
    data = dump_model(session, nullable=SESSION_NULLABLE)
    data["config"] = dump_model(session.config)
    data["characters"] = [dump_model(c) for c in session.characters]
    data["messages"] = [dump_model(m) for m in session.messages]
    data["stats"] = dump_model(session.stats)
    data["directors"] = [dump_model(d) for d in session.directors]
    data["memory"] = {
        cid: dump_model(m, nullable=frozenset({"relationships"}))
        for cid, m in session.memory.items()
    }
    return data


class SessionListItem(CamelModel):
    id: str
    topic: str
    status: SessionStatus
    message_count: int
    updated_at: int
    created_at: int
    characters: list[str]


class CharacterInput(CamelModel):
    name: str
    description: str | None = None
    personality: str | None = None
    color: str | None = None


# ============================== usage（归一化） ==============================


class NormalizedUsage(CamelModel):
    """对齐 TS NormalizedUsage（snake_case 字段名，非 camel）。"""

    model_config = ConfigDict(populate_by_name=True)

    prompt_tokens: int = 0
    completion_tokens: int = 0
    prompt_cache_hit_tokens: int = 0
    prompt_cache_miss_tokens: int = 0
    prompt_cache_write_tokens: int = 0
