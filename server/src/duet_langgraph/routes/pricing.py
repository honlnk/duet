"""模型价格查询路由（对齐 TS routes/pricing.ts：OpenRouter 公开列表代理 + 模糊匹配）。"""

from __future__ import annotations

import re
import time
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

OPENROUTER_URL = "https://openrouter.ai/api/v1/models"
CACHE_TTL_S = 3600

_cache: dict[str, Any] | None = None


async def _fetch_openrouter_models() -> list[dict[str, Any]]:
    global _cache
    if _cache and time.time() - _cache["fetchedAt"] < CACHE_TTL_S:
        return _cache["models"]
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(OPENROUTER_URL, headers={"User-Agent": "Duet-Chat/1.0"})
    if resp.status_code >= 400:
        raise RuntimeError(f"OpenRouter 返回 {resp.status_code}")
    data = resp.json().get("data")
    models = data if isinstance(data, list) else []
    _cache = {"models": models, "fetchedAt": time.time()}
    return models


def _strip_date_suffix(id_: str) -> str:
    s = re.sub(r"[-_](\d{4})?\d{2}\d{2}$", "", id_)
    return re.sub(r"-\d{8}$", "", s)


def _basename(id_: str) -> str:
    return id_.rsplit("/", 1)[-1]


def _match_model(target: str, models: list[dict[str, Any]]) -> dict[str, Any] | None:
    t = target.lower().strip()
    t_stripped = _strip_date_suffix(t)

    def is_standard(id_: str) -> bool:
        return not re.search(r":free$|:batch$|:nitro$", id_.lower())

    candidates: list[tuple[int, dict[str, Any]]] = []
    for m in models:
        mid = (m.get("id") or "").lower()
        base = _basename(mid)
        base_stripped = _strip_date_suffix(base)
        score = 0
        if base == t:
            score = 100
        elif base_stripped == t_stripped:
            score = 100
        elif t_stripped in base_stripped or base_stripped in t_stripped:
            score = 70
        elif t in mid or base in t:
            score = 50
        if score > 0:
            if is_standard(mid):
                score += 10
            if re.search(r"\d{4}$", base):
                score += 3
            candidates.append((score, m))
    if not candidates:
        return None
    candidates.sort(key=lambda pair: pair[0], reverse=True)
    return candidates[0][1]


def _per_tok_to_per_m(s: Any) -> float:
    try:
        n = float(s)
    except (TypeError, ValueError):
        return 0.0
    return n * 1_000_000


@router.get("/api/pricing/{model_id}")
async def get_pricing(model_id: str):
    target = model_id  # FastAPI 已做 URL decode
    try:
        models = await _fetch_openrouter_models()
    except Exception as e:
        return JSONResponse({"found": False, "error": str(e)}, status_code=502)
    matched = _match_model(target, models)
    if not matched or not matched.get("pricing"):
        return {"found": False}
    p = matched["pricing"]
    cache_hit = _per_tok_to_per_m(p.get("input_cache_read"))
    cache_write = _per_tok_to_per_m(p.get("input_cache_write"))
    return {
        "found": True,
        "matchedId": matched.get("id"),
        "pricing": {
            "inputPerMTok": _per_tok_to_per_m(p.get("prompt")),
            "outputPerMTok": _per_tok_to_per_m(p.get("completion")),
            "cacheHitPerMTok": cache_hit,
            "cacheWritePerMTok": cache_write,
            "hasCacheHit": cache_hit > 0,
            "hasCacheWrite": cache_write > 0,
        },
    }
