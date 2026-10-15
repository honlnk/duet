"""记忆层：单角色上下文管理（对齐 TS memory/context.ts）。"""

from __future__ import annotations

from typing import Any

from ..ai.prompts import (
    build_character_system,
    build_director_injection,
    build_summary_injection,
)
from ..schemas import CharacterMemoryData, CharacterRef, MemoryMessage, Session


class CharacterMemory:
    """一个角色的第一人称视角记忆（自己是 assistant，其他人是 user）。"""

    def __init__(
        self,
        character: CharacterRef,
        others: list[CharacterRef],
        topic: str,
        relationships: dict[str, str] | None = None,
    ):
        self.character = character
        self.others = others
        self.topic = topic
        self.messages: list[MemoryMessage] = []
        self.summary = ""
        self.last_summarized_round = 0
        self.relationships = relationships or {}

    # ----------------------------- 写入 -----------------------------

    def push_self(self, content: str) -> None:
        self.messages.append(MemoryMessage(role="assistant", content=content))

    def push_other(self, content: str) -> None:
        self.messages.append(MemoryMessage(role="user", content=content))

    def apply_summary(self, new_summary: str, last_round: int) -> None:
        self.summary = new_summary
        self.last_summarized_round = last_round

    def trim_to_recent(self, keep_recent: int) -> None:
        if len(self.messages) > keep_recent:
            self.messages = self.messages[-keep_recent:]

    # ----------------------------- 组装 -----------------------------

    def _extract_my_relationships(self) -> list[str]:
        out = []
        for other in self.others:
            rel = self.relationships.get(f"{self.character.id}->{other.id}", "")
            if rel and rel.strip():
                out.append(f"─── 我与{other.name}的关系 ───\n{rel.strip()}")
        return out

    def build_api_messages(
        self,
        scenario: str | None = None,
        directors: list[dict[str, Any]] | None = None,
        current_round: int | None = None,
    ) -> list[dict[str, str]]:
        """组装发给 LLM 的完整 messages（角色仅 system/user/assistant）。

        导演指令临时拼接到最后一条消息尾部（紧贴生成点，不写回记忆）。
        """
        sys = build_character_system(
            name=self.character.name,
            description=self.character.description,
            personality=self.character.personality,
            others=[o.model_dump(by_alias=True, exclude_none=True) for o in self.others],
            relationships=self._extract_my_relationships(),
            topic=self.topic,
            scenario=scenario,
        )
        out: list[dict[str, str]] = [{"role": "system", "content": sys}]
        if self.summary:
            out.append({"role": "system", "content": build_summary_injection(self.summary)})
        out.extend({"role": m.role, "content": m.content} for m in self.messages)

        if directors and current_round is not None and out:
            injection = build_director_injection(directors, current_round)
            if injection:
                last = out[-1]
                out[-1] = {"role": last["role"], "content": f"{last['content']}\n\n{injection}"}
        return out

    # ----------------------------- 序列化 -----------------------------

    def to_data(self) -> CharacterMemoryData:
        return CharacterMemoryData(
            character=self.character,
            others=self.others,
            topic=self.topic,
            messages=self.messages,
            summary=self.summary,
            lastSummarizedRound=self.last_summarized_round,
            relationships=self.relationships,
        )

    @classmethod
    def from_data(cls, data: CharacterMemoryData) -> CharacterMemory:
        m = cls(data.character, data.others or [], data.topic, data.relationships or {})
        m.messages = list(data.messages or [])
        m.summary = data.summary or ""
        m.last_summarized_round = data.last_summarized_round or 0
        return m


def restore_memories(session: Session) -> dict[str, CharacterMemory]:
    """从会话持久化形态还原每个角色的记忆实例。"""
    mems: dict[str, CharacterMemory] = {}
    for a in session.characters:
        data = session.memory.get(a.id)
        if data:
            mem = CharacterMemory.from_data(data)
        else:
            others = [o for o in session.characters if o.id != a.id]
            mem = CharacterMemory(a, others, session.topic, session.relationships)
        mem.relationships = session.relationships or {}
        mems[a.id] = mem
    return mems
