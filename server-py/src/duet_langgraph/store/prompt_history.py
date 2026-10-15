"""Prompt 历史记录（内存态环形缓冲，对齐 TS store/promptHistory.ts）。

捕获「即将发出的真实 Prompt」快照，每角色保留最近 20 条；进程重启即丢失。
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

MAX_PER_CHARACTER = 20

# sessionId → characterId → 快照列表（最新在尾）
_store: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))


def record_prompt(session_id: str, entry: dict[str, Any]) -> None:
    per_character = _store[session_id]
    lst = per_character[entry["characterId"]]
    lst.append(entry)
    if len(lst) > MAX_PER_CHARACTER:
        del lst[: len(lst) - MAX_PER_CHARACTER]


def get_prompts(
    session_id: str,
    character_id: str | None = None,
    limit: int = MAX_PER_CHARACTER,
) -> list[dict[str, Any]]:
    per_session = _store.get(session_id)
    if not per_session:
        return []
    if character_id:
        lst = per_session.get(character_id, [])
        return list(reversed(lst[-limit:]))
    all_snapshots: list[dict[str, Any]] = []
    for lst in per_session.values():
        all_snapshots.extend(lst)
    all_snapshots.sort(key=lambda e: e["timestamp"], reverse=True)
    return all_snapshots[:limit]


def clear_prompts(session_id: str) -> None:
    _store.pop(session_id, None)
