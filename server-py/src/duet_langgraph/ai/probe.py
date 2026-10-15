"""上游探测：模型列表 + 思考档位（对齐 TS 各适配器 listModels 与 ai/thinking-options.ts）。

这一层不经过 langchain model 类（它们不提供 list-models 能力），
直接用 httpx 按各协议原生 REST 端点探测。
"""

from __future__ import annotations

import re
from typing import Any

import httpx

from ..schemas import ApiProtocol

TIMEOUT_S = 15.0


class ProbeError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def _trim_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


async def _read_error(resp: httpx.Response) -> str:
    try:
        body = await resp.aread()
        text = body.decode("utf-8", errors="replace")[:200]
    except Exception:
        text = ""
    return text


async def list_models(
    protocol: ApiProtocol, base_url: str, api_key: str, model: str = ""
) -> list[str]:
    """拉取上游模型列表（去重排序；失败抛 ProbeError 含状态码）。"""
    base = _trim_base_url(base_url)
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
        if protocol == "anthropic":
            url = f"{base}/v1/models"
            headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
            resp = await client.get(url, headers=headers)
        elif protocol == "gemini":
            url = f"{base}/v1beta/models"
            params = {"key": api_key}
            resp = await client.get(url, params=params)
        else:  # openai / openai-responses
            url = f"{base}/models"
            headers = {"Authorization": f"Bearer {api_key}"}
            resp = await client.get(url, headers=headers)

    if resp.status_code >= 400:
        raise ProbeError(
            f"拉取模型列表失败 {resp.status_code}: {await _read_error(resp)}",
            resp.status_code,
        )
    data: dict[str, Any] = resp.json()
    if protocol == "gemini":
        ids = [
            name.replace("models/", "")
            for name in (m.get("name") or "" for m in data.get("models") or [])
            if name.replace("models/", "")
        ]
    else:
        ids = [i for i in (m.get("id") for m in data.get("data") or []) if isinstance(i, str)]
    return sorted(set(ids))


# ----------------------------- 思考档位 -----------------------------

OPENAI_EFFORTS = [
    {"key": "none", "label": "关闭"},
    {"key": "minimal", "label": "极低"},
    {"key": "low", "label": "低"},
    {"key": "medium", "label": "中"},
    {"key": "high", "label": "高"},
]

GEMINI_LEVELS = [
    {"key": "MINIMAL", "label": "极低"},
    {"key": "LOW", "label": "低"},
    {"key": "MEDIUM", "label": "中"},
    {"key": "HIGH", "label": "高"},
]

ANTHROPIC_OPTIONS = [
    {"key": "adaptive", "label": "自适应（推荐）"},
    {"key": "disabled", "label": "关闭"},
]

_OPENAI_REASONING_RE = re.compile(r"^(o\d|gpt-[56]|gpt-o)", re.IGNORECASE)
_GEMINI_THINKING_RE = re.compile(r"gemini-(2\.5|3|\d)", re.IGNORECASE)


def _extract_default(protocol: ApiProtocol, tc: dict[str, Any] | None) -> str | None:
    if not tc:
        return None
    if protocol == "openai":
        v = tc.get("reasoning_effort")
        return v if isinstance(v, str) else None
    if protocol == "openai-responses":
        r = tc.get("reasoning")
        v = r.get("effort") if isinstance(r, dict) else None
        return v if isinstance(v, str) else None
    if protocol == "anthropic":
        t = tc.get("thinking")
        v = t.get("type") if isinstance(t, dict) else None
        return v if isinstance(v, str) else None
    # gemini
    gc = tc.get("generationConfig")
    inner = gc.get("thinkingConfig", {}).get("thinkingLevel") if isinstance(gc, dict) else None
    if isinstance(inner, str):
        return inner
    v = tc.get("thinkingLevel")
    return v if isinstance(v, str) else None


async def _anthropic_thinking_supported(
    base_url: str, api_key: str, model: str
) -> bool:
    url = f"{_trim_base_url(base_url)}/v1/models/{model}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            resp = await client.get(
                url, headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"}
            )
        if resp.status_code >= 400:
            return False
        caps = resp.json().get("capabilities") or {}
        return (caps.get("thinking") or {}).get("supported") is True
    except Exception:
        return False


async def fetch_thinking_options(
    protocol: ApiProtocol,
    base_url: str,
    api_key: str,
    model: str,
    thinking_config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """思考可选项（统一结构：supported / options / providerDefault）。"""
    provider_default = _extract_default(protocol, thinking_config)
    if protocol == "anthropic":
        supported = await _anthropic_thinking_supported(base_url, api_key, model)
        return {
            "supported": supported,
            "options": ANTHROPIC_OPTIONS if supported else [],
            "providerDefault": provider_default,
        }
    if protocol == "gemini":
        supported = bool(_GEMINI_THINKING_RE.search(model))
        return {
            "supported": supported,
            "options": GEMINI_LEVELS if supported else [],
            "providerDefault": provider_default,
        }
    # openai / openai-responses
    supported = bool(_OPENAI_REASONING_RE.search(model))
    return {
        "supported": supported,
        "options": OPENAI_EFFORTS if supported else [],
        "providerDefault": provider_default,
    }
