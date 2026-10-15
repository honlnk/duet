"""汇率查询路由（对齐 TS routes/exchange.ts：open.er-api.com + 三层降级缓存）。"""

from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

ER_API_URL = "https://open.er-api.com/v6/latest/USD"
CACHE_TTL_S = 6 * 3600

_cache: dict[str, Any] | None = None


async def _refresh_from_upstream() -> dict[str, float]:
    global _cache
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(ER_API_URL, headers={"User-Agent": "Duet-Chat/1.0"})
    if resp.status_code >= 400:
        raise RuntimeError(f"汇率服务返回 {resp.status_code}")
    data = resp.json()
    if data.get("result") != "success" or not isinstance(data.get("rates"), dict):
        raise RuntimeError("汇率数据格式异常")
    _cache = {"rates": data["rates"], "fetchedAt": time.time()}
    return data["rates"]


async def fetch_rates() -> dict[str, float]:
    """三层降级：新鲜缓存 → 刷新（失败回退陈旧缓存）→ 抛错。"""
    global _cache
    if _cache and time.time() - _cache["fetchedAt"] < CACHE_TTL_S:
        return _cache["rates"]
    try:
        return await _refresh_from_upstream()
    except Exception:
        if _cache:
            return _cache["rates"]
        raise


@router.get("/api/exchange-rates")
async def exchange_rates():
    try:
        rates = await fetch_rates()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)
    return {"base": "USD", "rates": rates}
