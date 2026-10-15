"""资产库持久化层（对齐 TS store/libraryStore.ts，library.json 格式 100% 兼容）。

REST 路由与导演 Agent 工具共用本模块；Agent 工具只调内存函数，绝不碰文件系统。
"""

from __future__ import annotations

import json
import logging
import os
import random
import string
import time
from typing import Any

from ..config import get_config

logger = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _gen_id(prefix: str) -> str:
    alphabet = string.digits + string.ascii_lowercase
    n = _now_ms()
    digits = []
    while n:
        digits.append(alphabet[n % 36])
        n //= 36
    ts = "".join(reversed(digits))
    return f"{prefix}_{ts}{random.choices(alphabet, k=4)}"


def _empty_library() -> dict[str, Any]:
    return {
        "characterTemplates": [],
        "topicTemplates": [],
        "worldviewTemplates": [],
        "relationships": {},
        "nodePositions": {},
    }


_data: dict[str, Any] | None = None


def _str(v: Any, fallback: str = "") -> str:
    return v.strip() if isinstance(v, str) else fallback


def _load() -> dict[str, Any]:
    global _data
    if _data is not None:
        return _data
    file = get_config().library_file
    if not os.path.exists(file):
        _data = _empty_library()
        return _data
    try:
        with open(file, encoding="utf-8") as f:
            parsed = json.load(f)
        _data = {
            "characterTemplates": parsed.get("characterTemplates")
            if isinstance(parsed.get("characterTemplates"), list)
            else [],
            "topicTemplates": parsed.get("topicTemplates")
            if isinstance(parsed.get("topicTemplates"), list)
            else [],
            "worldviewTemplates": parsed.get("worldviewTemplates")
            if isinstance(parsed.get("worldviewTemplates"), list)
            else [],
            "relationships": parsed.get("relationships")
            if isinstance(parsed.get("relationships"), dict)
            else {},
            "nodePositions": parsed.get("nodePositions")
            if isinstance(parsed.get("nodePositions"), dict)
            else {},
        }
    except (OSError, json.JSONDecodeError) as e:
        logger.error("[library] 资产库文件损坏，从空库启动: %s", e)
        _data = _empty_library()
    return _data


def _save() -> None:
    lib = _load()
    file = get_config().library_file
    os.makedirs(os.path.dirname(file), exist_ok=True)
    tmp = str(file) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(lib, f, ensure_ascii=False, indent=2)
    os.replace(tmp, file)


# --------------------------- 角色模板 ---------------------------


def list_character_templates() -> list[dict[str, Any]]:
    return [dict(t) for t in _load()["characterTemplates"]]


def upsert_character_template(input_data: dict[str, Any]) -> dict[str, Any]:
    lib = _load()
    name = _str(input_data.get("name"))
    if not name:
        raise ValueError("角色模板的 name 不能为空")

    input_id = input_data.get("id")
    if input_id:
        existing = next((t for t in lib["characterTemplates"] if t.get("id") == input_id), None)
        if existing is None:
            raise LookupError(f"角色模板不存在: {input_id}")
        existing["name"] = name
        existing["description"] = _str(input_data.get("description"))
        existing["personality"] = _str(input_data.get("personality"))
        _save()
        return dict(existing)

    created = {
        "id": _gen_id("ct"),
        "name": name,
        "description": _str(input_data.get("description")),
        "personality": _str(input_data.get("personality")),
        "createdAt": _now_ms(),
    }
    lib["characterTemplates"].append(created)
    _save()
    return dict(created)


def delete_character_template(id_: str) -> bool:
    lib = _load()
    idx = next((i for i, t in enumerate(lib["characterTemplates"]) if t.get("id") == id_), None)
    if idx is None:
        return False
    lib["characterTemplates"].pop(idx)
    # 级联清理：关系两端引用该模板的条目 + 画布节点坐标
    for key in [k for k in lib["relationships"]]:
        parts = key.split("->")
        if len(parts) >= 2 and (parts[0] == id_ or parts[1] == id_):
            del lib["relationships"][key]
    lib["nodePositions"].pop(id_, None)
    _save()
    return True


# --------------------------- 话题模板 ---------------------------


def list_topic_templates() -> list[dict[str, Any]]:
    return [dict(t) for t in _load()["topicTemplates"]]


def upsert_topic_template(input_data: dict[str, Any]) -> dict[str, Any]:
    lib = _load()
    content = _str(input_data.get("content"))
    if not content:
        raise ValueError("话题模板的 content 不能为空")

    input_id = input_data.get("id")
    if input_id:
        existing = next((t for t in lib["topicTemplates"] if t.get("id") == input_id), None)
        if existing is None:
            raise LookupError(f"话题模板不存在: {input_id}")
        existing["content"] = content
        _save()
        return dict(existing)

    created = {"id": _gen_id("tt"), "content": content, "createdAt": _now_ms()}
    lib["topicTemplates"].append(created)
    _save()
    return dict(created)


def delete_topic_template(id_: str) -> bool:
    lib = _load()
    idx = next((i for i, t in enumerate(lib["topicTemplates"]) if t.get("id") == id_), None)
    if idx is None:
        return False
    lib["topicTemplates"].pop(idx)
    _save()
    return True


# --------------------------- 世界观模板 ---------------------------


def list_worldview_templates() -> list[dict[str, Any]]:
    return [dict(t) for t in _load()["worldviewTemplates"]]


def upsert_worldview_template(input_data: dict[str, Any]) -> dict[str, Any]:
    lib = _load()
    name = _str(input_data.get("name"))
    if not name:
        raise ValueError("世界观模板的 name 不能为空")

    input_id = input_data.get("id")
    if input_id:
        existing = next(
            (t for t in lib["worldviewTemplates"] if t.get("id") == input_id), None
        )
        if existing is None:
            raise LookupError(f"世界观模板不存在: {input_id}")
        existing["name"] = name
        existing["scenario"] = _str(input_data.get("scenario"))
        _save()
        return dict(existing)

    created = {
        "id": _gen_id("wt"),
        "name": name,
        "scenario": _str(input_data.get("scenario")),
        "createdAt": _now_ms(),
    }
    lib["worldviewTemplates"].append(created)
    _save()
    return dict(created)


def delete_worldview_template(id_: str) -> bool:
    lib = _load()
    idx = next(
        (i for i, t in enumerate(lib["worldviewTemplates"]) if t.get("id") == id_), None
    )
    if idx is None:
        return False
    lib["worldviewTemplates"].pop(idx)
    _save()
    return True


# --------------------------- 关系 + 节点坐标 ---------------------------


def get_relationships() -> dict[str, Any]:
    lib = _load()
    return {
        "relationships": dict(lib["relationships"]),
        "nodePositions": json.loads(json.dumps(lib["nodePositions"])),
    }


def set_relationships(
    relationships: dict[str, str],
    node_positions: dict[str, Any] | None = None,
) -> None:
    lib = _load()
    lib["relationships"] = _clean_relationships(relationships)
    if isinstance(node_positions, dict):
        lib["nodePositions"] = node_positions
    _save()


def set_relationship(from_template_id: str, to_template_id: str, description: str) -> None:
    lib = _load()
    if not from_template_id or not to_template_id:
        raise ValueError("关系两端的角色模板 id 不能为空")
    if from_template_id == to_template_id:
        raise ValueError("不能设置指向自己的关系")
    lib["relationships"][f"{from_template_id}->{to_template_id}"] = description
    _save()


def delete_relationship(from_template_id: str, to_template_id: str) -> bool:
    lib = _load()
    key = f"{from_template_id}->{to_template_id}"
    if key not in lib["relationships"]:
        return False
    del lib["relationships"][key]
    _save()
    return True


def _clean_relationships(rels: dict[str, str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in rels.items():
        parts = key.split("->")
        if len(parts) < 2 or not parts[0] or not parts[1] or parts[0] == parts[1]:
            continue
        if not isinstance(value, str) or not value.strip():
            continue
        out[key] = value
    return out


# --------------------------- 迁移导入 ---------------------------


def library_is_empty() -> bool:
    lib = _load()
    return (
        not lib["characterTemplates"]
        and not lib["topicTemplates"]
        and not lib["worldviewTemplates"]
        and not lib["relationships"]
    )


def import_library(payload: dict[str, Any]) -> dict[str, int]:
    """一次性迁移导入：按 id upsert，幂等。"""
    lib = _load()
    result = {"characters": 0, "topics": 0, "worldviews": 0, "relationships": 0}

    for raw in payload.get("characterTemplates") or []:
        if not isinstance(raw, dict) or not raw.get("id") or not _str(raw.get("name")):
            continue
        existing = next(
            (t for t in lib["characterTemplates"] if t.get("id") == raw["id"]), None
        )
        if existing:
            existing["name"] = _str(raw.get("name"))
            existing["description"] = _str(raw.get("description"))
            existing["personality"] = _str(raw.get("personality"))
        else:
            lib["characterTemplates"].append(
                {
                    "id": raw["id"],
                    "name": _str(raw.get("name")),
                    "description": _str(raw.get("description")),
                    "personality": _str(raw.get("personality")),
                    "createdAt": raw["createdAt"]
                    if isinstance(raw.get("createdAt"), int)
                    else _now_ms(),
                }
            )
        result["characters"] += 1

    for raw in payload.get("topicTemplates") or []:
        if not isinstance(raw, dict) or not raw.get("id") or not _str(raw.get("content")):
            continue
        existing = next((t for t in lib["topicTemplates"] if t.get("id") == raw["id"]), None)
        if existing:
            existing["content"] = _str(raw.get("content"))
        else:
            lib["topicTemplates"].append(
                {
                    "id": raw["id"],
                    "content": _str(raw.get("content")),
                    "createdAt": raw.get("createdAt")
                    if isinstance(raw.get("createdAt"), int)
                    else _now_ms(),
                }
            )
        result["topics"] += 1

    for raw in payload.get("worldviewTemplates") or []:
        if not isinstance(raw, dict) or not raw.get("id") or not _str(raw.get("name")):
            continue
        existing = next(
            (t for t in lib["worldviewTemplates"] if t.get("id") == raw["id"]), None
        )
        if existing:
            existing["name"] = _str(raw.get("name"))
            existing["scenario"] = _str(raw.get("scenario"))
        else:
            lib["worldviewTemplates"].append(
                {
                    "id": raw["id"],
                    "name": _str(raw.get("name")),
                    "scenario": _str(raw.get("scenario")),
                    "createdAt": raw.get("createdAt")
                    if isinstance(raw.get("createdAt"), int)
                    else _now_ms(),
                }
            )
        result["worldviews"] += 1

    if isinstance(payload.get("relationships"), dict):
        lib["relationships"].update(_clean_relationships(payload["relationships"]))
        result["relationships"] = len(payload["relationships"])

    if isinstance(payload.get("nodePositions"), dict):
        lib["nodePositions"].update(payload["nodePositions"])

    _save()
    return result


# --------------------------- 测试辅助 ---------------------------


def _reset_for_test() -> None:
    """仅测试用：清空内存态，下次访问重新从磁盘加载。"""
    global _data
    _data = None
