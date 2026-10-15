"""会话存储层。

与 TS 版 sessionStore 的差异（设计落定，见施工日志 S1）：
- 存储介质从「每会话一个 JSON 文件」改为单一 sqlite（DATA_DIR/duet.db）的
  sessions_meta 表（id / created_at / updated_at / data JSON blob）；
  S2 的 LangGraph SqliteSaver checkpointer 将共用同一个 db 文件。
- 对外行为对齐 TS：列表按 updatedAt 倒序、启动恢复 running→stopped（reason=crashed）。
- TS 的 normalizeLegacySession（智能体时期旧数据归一化）不移植——
  Python 版明确不迁移 TS 会话数据（计划 §7），不存在旧格式输入。
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import uuid
from typing import Any

from ..config import get_config
from ..schemas import (
    DEFAULT_CHARACTER_COLORS,
    MAX_CHARACTERS,
    MIN_CHARACTERS,
    CharacterMemoryData,
    CharacterRef,
    Session,
    SessionConfig,
    SessionStats,
    now_ms,
)
from ..utils.cost import CostRates, estimate_step_cost, round6
from ..utils.currency import convert_currency

logger = logging.getLogger(__name__)

CHARACTER_ORDER = ("A", "B", "C", "D", "E", "F", "G", "H", "I", "J")


def character_id_at(index: int) -> str:
    return CHARACTER_ORDER[index] if 0 <= index < len(CHARACTER_ORDER) else "A"


DEFAULT_CONFIG: dict[str, Any] = {
    "maxRounds": 0,
    "durationSec": 0,
    "model": "deepseek-v4-flash",
    "temperature": 0.7,
    "summaryEveryN": 10,
    "keepRecent": 8,
    "pacingEnabled": True,
    "pacingBufferRounds": 2,
}

_conn: sqlite3.Connection | None = None
_lock = threading.Lock()


def _connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        path = get_config().data_root / "duet.db"
        path.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(path), check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions_meta (
                id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                data TEXT NOT NULL
            )
            """
        )
        _conn.commit()
    return _conn


def _reset_for_test() -> None:
    """仅测试用：丢弃连接（配合 DATA_DIR 指向新临时目录）。"""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None


def default_config(overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    if overrides:
        for key, value in overrides.items():
            if value is not None:
                cfg[key] = value
    return cfg


def create_session(
    topic: str,
    characters: list[dict[str, Any]],
    config: dict[str, Any] | None = None,
    relationships: dict[str, str] | None = None,
) -> Session:
    """创建新会话对象（2~10 角色，A/B/C… 顺序分配 id 与默认色）。"""
    now = now_ms()
    inputs = [a for a in characters[:MAX_CHARACTERS] if a]

    refs: list[CharacterRef] = []
    n_colors = len(DEFAULT_CHARACTER_COLORS)
    for i, a in enumerate(inputs):
        cid = character_id_at(i)
        name = (a.get("name") or "").strip() or f"角色 {cid}"
        color = (a.get("color") or "").strip() or DEFAULT_CHARACTER_COLORS[i % n_colors]
        refs.append(
            CharacterRef(
                id=cid,
                name=name,
                description=(a.get("description") or "").strip() or None,
                personality=(a.get("personality") or "").strip() or None,
                color=color or "blue",
            )
        )

    relationships = relationships or {}
    memory: dict[str, CharacterMemoryData] = {}
    for i, ref in enumerate(refs):
        others = [o for j, o in enumerate(refs) if j != i]
        memory[ref.id] = CharacterMemoryData(
            character=ref,
            others=others,
            topic=topic,
            messages=[],
            summary="",
            lastSummarizedRound=0,
            relationships=relationships,
        )

    return Session(
        id="sess_" + str(uuid.uuid4()),
        topic=topic,
        characters=refs,
        config=SessionConfig(**{k: v for k, v in default_config(config).items()}),
        status="idle",
        finishedReason=None,
        startedAt=None,
        stoppedAt=None,
        messageCount=0,
        currentCharacterId="A",
        messages=[],
        memory=memory,
        stats=SessionStats(),
        error=None,
        createdAt=now,
        updatedAt=now,
        relationships=relationships,
        directors=[],
    )


def save_session(session: Session) -> None:
    from ..schemas import dump_session

    session.updated_at = now_ms()
    data = json.dumps(dump_session(session), ensure_ascii=False)
    with _lock:
        conn = _connection()
        conn.execute(
            """
            INSERT INTO sessions_meta (id, created_at, updated_at, data)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data
            """,
            (session.id, session.created_at, session.updated_at, data),
        )
        conn.commit()


def load_session(id_: str) -> Session | None:
    with _lock:
        row = _connection().execute(
            "SELECT data FROM sessions_meta WHERE id = ?", (id_,)
        ).fetchone()
    if row is None:
        return None
    try:
        return Session.model_validate(json.loads(row[0]))
    except Exception as e:
        logger.error("[store] 会话数据损坏: %s %s", id_, e)
        return None


def list_sessions() -> list[dict[str, Any]]:
    """列表项（characters 是 name 数组），按 updatedAt 倒序。"""
    with _lock:
        rows = _connection().execute(
            "SELECT id, updated_at, data FROM sessions_meta ORDER BY updated_at DESC"
        ).fetchall()
    out = []
    for _sid, _updated_at, data in rows:
        try:
            s = json.loads(data)
            out.append(
                {
                    "id": s["id"],
                    "topic": s["topic"],
                    "status": s["status"],
                    "messageCount": s["messageCount"],
                    "updatedAt": s["updatedAt"],
                    "createdAt": s["createdAt"],
                    "characters": [c["name"] for c in s.get("characters", [])],
                }
            )
        except Exception:
            continue
    return out


def delete_session(id_: str) -> bool:
    with _lock:
        cur = _connection().execute("DELETE FROM sessions_meta WHERE id = ?", (id_,))
        _connection().commit()
    return cur.rowcount > 0


def recover_sessions(reason: str = "crashed") -> int:
    """启动恢复：running → stopped；进程退出前也可传 reason=shutdown 做落盘冲刷。"""
    n = 0
    with _lock:
        conn = _connection()
        rows = conn.execute(
            "SELECT id, data FROM sessions_meta WHERE data LIKE '%\"running\"%'"
        ).fetchall()
    for sid, data in rows:
        try:
            s = json.loads(data)
        except Exception:
            continue
        if s.get("status") != "running":
            continue
        s["status"] = "stopped"
        s["finishedReason"] = s.get("finishedReason") or reason
        s["updatedAt"] = now_ms()
        with _lock:
            conn.execute(
                "UPDATE sessions_meta SET updated_at = ?, data = ? WHERE id = ?",
                (s["updatedAt"], json.dumps(s, ensure_ascii=False), sid),
            )
            conn.commit()
        n += 1
    return n


def add_stats(
    session: Session,
    usage,
    rates: CostRates,
    display_currency: str,
    exchange_rates: dict[str, float],
) -> None:
    """token 统计 + 增量成本（与 TS addStats 同规则）。"""
    st = session.stats
    st.total_prompt_tokens += usage.prompt_tokens or 0
    st.total_completion_tokens += usage.completion_tokens or 0
    st.total_cache_hit_tokens += usage.prompt_cache_hit_tokens or 0
    st.total_cache_miss_tokens += usage.prompt_cache_miss_tokens or 0
    st.total_cache_write_tokens += usage.prompt_cache_write_tokens or 0
    st.total_tokens = st.total_prompt_tokens + st.total_completion_tokens
    st.cost_currency = display_currency
    step_local = estimate_step_cost(usage, rates)
    step_display = convert_currency(
        step_local, exchange_rates, rates.currency or display_currency, display_currency
    )
    st.est_cost = round6(st.est_cost + step_display)


def current_round(session: Session) -> int:
    """1 round = 所有角色各发言一次。"""
    n = len(session.characters) or MIN_CHARACTERS
    return session.message_count // n


def next_character_id(session: Session) -> str:
    n = len(session.characters)
    cur_idx = CHARACTER_ORDER.index(session.current_character_id)
    return session.characters[(cur_idx + 1) % n].id
