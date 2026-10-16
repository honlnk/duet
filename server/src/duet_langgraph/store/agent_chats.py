"""导演助手聊天历史（JSON 落盘，data/agent-chats.json）。

TS 时代的决策是「聊天历史不持久化」；应用户需求改为简单持久化：
- 展示条目（user / assistant / tool）随流式事件增量落盘；
  system 提示条（错误/停止等瞬态反馈）不落盘
- 工具行只存展示所需字段；重建 Agent 上下文时只还原 user/assistant 文本，
  工具调用不回灌上下文（展示用历史 ≠ 模型上下文，后者由内存会话态持有全量）
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage

from ..config import get_config

logger = logging.getLogger(__name__)

TITLE_LEN = 30

_data: dict[str, Any] | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _load() -> dict[str, Any]:
    global _data
    if _data is not None:
        return _data
    file = get_config().data_root / "agent-chats.json"
    if not os.path.exists(file):
        _data = {"chats": []}
        return _data
    try:
        with open(file, encoding="utf-8") as f:
            parsed = json.load(f)
        chats = parsed.get("chats") if isinstance(parsed.get("chats"), list) else []
        _data = {"chats": chats}
    except (OSError, json.JSONDecodeError) as e:
        logger.error("[agent-chats] 历史文件损坏，从空历史启动: %s", e)
        _data = {"chats": []}
    return _data


def _save() -> None:
    file = get_config().data_root / "agent-chats.json"
    os.makedirs(os.path.dirname(file), exist_ok=True)
    tmp = str(file) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_load(), f, ensure_ascii=False, indent=2)
    os.replace(tmp, file)


def _find(chat_id: str) -> dict[str, Any] | None:
    return next((c for c in _load()["chats"] if c.get("id") == chat_id), None)


def create_or_get(chat_id: str) -> dict[str, Any]:
    """取历史会话；不存在则建空记录（首条消息落盘前不写文件）。"""
    chat = _find(chat_id)
    if chat is None:
        chat = {
            "id": chat_id,
            "title": "",
            "createdAt": _now_ms(),
            "updatedAt": _now_ms(),
            "messages": [],
        }
        _load()["chats"].append(chat)
    return chat


def append_message(chat_id: str, kind: str, **fields: Any) -> dict[str, Any]:
    """追加一条展示消息并落盘；首条 user 消息自动成为标题。"""
    chat = create_or_get(chat_id)
    entry = {"kind": kind, "ts": _now_ms(), **fields}
    chat["messages"].append(entry)
    chat["updatedAt"] = entry["ts"]
    if not chat["title"] and kind == "user":
        text = str(fields.get("content", "")).strip().replace("\n", " ")
        chat["title"] = text[:TITLE_LEN] + ("…" if len(text) > TITLE_LEN else "")
    _save()
    return dict(entry)


def list_chats() -> list[dict[str, Any]]:
    """历史列表（新→旧），只带摘要字段不含消息体。"""
    chats = _load()["chats"]
    return [
        {
            "id": c.get("id", ""),
            "title": c.get("title", ""),
            "createdAt": c.get("createdAt", 0),
            "updatedAt": c.get("updatedAt", 0),
            "messageCount": len(c.get("messages", [])),
        }
        for c in sorted(chats, key=lambda c: c.get("updatedAt", 0), reverse=True)
    ]


def get_chat(chat_id: str) -> dict[str, Any] | None:
    chat = _find(chat_id)
    return json.loads(json.dumps(chat)) if chat is not None else None


def delete_chat(chat_id: str) -> bool:
    lib = _load()
    idx = next((i for i, c in enumerate(lib["chats"]) if c.get("id") == chat_id), None)
    if idx is None:
        return False
    lib["chats"].pop(idx)
    _save()
    return True


def history_messages(chat_id: str) -> list[AnyMessage]:
    """从落盘历史重建 Agent 上下文（仅 user/assistant 文本，工具行不回灌）。"""
    chat = _find(chat_id)
    if chat is None:
        return []
    msgs: list[AnyMessage] = []
    for m in chat.get("messages", []):
        content = str(m.get("content", ""))
        if not content:
            continue
        if m.get("kind") == "user":
            msgs.append(HumanMessage(content=content))
        elif m.get("kind") == "assistant":
            msgs.append(AIMessage(content=content))
    return msgs


def _reset_for_test() -> None:
    global _data
    _data = None
