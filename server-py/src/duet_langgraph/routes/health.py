"""health / config-limits 路由（字段与 TS 版 routes/health.ts 逐字段对齐）。"""

from __future__ import annotations

import time

from fastapi import APIRouter

from ..config import get_config
from ..store import providers

router = APIRouter()


@router.get("/api/health")
async def health() -> dict:
    cfg = get_config()
    items = providers.list_provider_items()
    return {
        "status": "ok",
        "ts": int(time.time() * 1000),
        "env": cfg.env,
        "providerCount": len(items["providers"]),
        "hasDefaultProvider": bool(items["defaultId"]),
        "limits": {
            "absoluteMaxRounds": cfg.absolute_max_rounds,
            "absoluteMaxDurationSec": cfg.absolute_max_duration_sec,
        },
    }


@router.get("/api/config/limits")
async def config_limits() -> dict:
    cfg = get_config()
    items = providers.list_provider_items()
    return {
        "absoluteMaxRounds": cfg.absolute_max_rounds,
        "absoluteMaxDurationSec": cfg.absolute_max_duration_sec,
        "defaultProviderId": items["defaultId"],
    }
