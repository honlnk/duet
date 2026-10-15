"""providers.json 读取助手（S0 最小实现；完整 store 在 S1 扩展）。

文件结构（与 TS 版 100% 兼容）::

    {"providers": [Provider...], "defaultId": "prov_..."}
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..config import get_config

logger = logging.getLogger(__name__)

EMPTY_FILE: dict[str, Any] = {"providers": [], "defaultId": ""}


def load_raw() -> dict[str, Any]:
    """读取 providers.json；文件不存在或损坏时返回空结构（不抛错）。"""
    file = get_config().providers_file
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"providers": [], "defaultId": ""}
    except (OSError, json.JSONDecodeError) as e:
        logger.error("[provider] 配置文件损坏: %s", e)
        return {"providers": [], "defaultId": ""}
    if not isinstance(data, dict) or not isinstance(data.get("providers"), list):
        return {"providers": [], "defaultId": ""}
    return data
