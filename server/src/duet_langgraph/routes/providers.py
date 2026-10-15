"""providers 路由（对齐 TS routes/providers.ts 的行为与错误语义）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..ai import probe
from ..schemas import ApiProtocol, ProviderFormData
from ..store import providers

router = APIRouter()


def _model_fetch_error(e: Exception) -> str:
    hint = "（API Key 无效或权限不足）" if getattr(e, "status", None) in (401, 403) else ""
    return f"{e}{hint}"


async def _form_data(request: Request, *, required: bool) -> dict[str, Any] | None:
    try:
        body = await request.json()
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    if required:
        for key in ("name", "baseUrl", "apiKey", "model"):
            v = body.get(key)
            if not isinstance(v, str) or not v:
                return None
    return body


@router.get("/api/providers")
async def list_providers() -> dict:
    return providers.list_provider_items()


@router.post("/api/providers")
async def create_provider(request: Request):
    body = await _form_data(request, required=True)
    if body is None:
        return JSONResponse({"error": "参数非法"}, status_code=400)
    try:
        data = ProviderFormData.model_validate(body)
    except Exception:
        return JSONResponse({"error": "参数非法"}, status_code=400)
    providers.add_provider(data)
    return providers.list_provider_items()


@router.put("/api/providers/{id_}")
async def update_provider(id_: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    result = providers.update_provider(id_, body)
    if result is None:
        return JSONResponse({"error": "Provider 不存在"}, status_code=404)
    return providers.list_provider_items()


@router.delete("/api/providers/{id_}")
async def delete_provider(id_: str):
    ok, reason = providers.delete_provider(id_)
    if not ok:
        return JSONResponse({"error": reason}, status_code=400)
    return providers.list_provider_items()


@router.put("/api/providers/default/{id_}")
async def set_default_provider(id_: str):
    if not providers.set_default_provider(id_):
        return JSONResponse({"error": "Provider 不存在"}, status_code=404)
    return providers.list_provider_items()


@router.post("/api/providers/{id_}/models")
async def provider_models(id_: str):
    p = providers.get_provider(id_)
    if p is None:
        return JSONResponse({"error": "Provider 不存在"}, status_code=404)
    try:
        models = await probe.list_models(p.protocol, p.base_url, p.api_key)
    except Exception as e:
        return JSONResponse({"error": _model_fetch_error(e)}, status_code=502)
    return {"models": models}


@router.post("/api/providers/models")
async def adhoc_models(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "参数非法"}, status_code=400)
    if not isinstance(body, dict) or not body.get("baseUrl") or not body.get("apiKey"):
        return JSONResponse({"error": "参数非法"}, status_code=400)
    protocol: ApiProtocol = body.get("protocol") or "openai"
    try:
        models = await probe.list_models(protocol, body["baseUrl"], body["apiKey"])
    except Exception as e:
        return JSONResponse({"error": _model_fetch_error(e)}, status_code=502)
    return {"models": models}


@router.post("/api/providers/{id_}/thinking-options")
async def provider_thinking_options(id_: str):
    p = providers.get_provider(id_)
    if p is None:
        return JSONResponse({"error": "Provider 不存在"}, status_code=404)
    try:
        return await probe.fetch_thinking_options(
            p.protocol, p.base_url, p.api_key, p.model, p.thinking_config
        )
    except Exception as e:
        return JSONResponse({"error": _model_fetch_error(e)}, status_code=502)


@router.post("/api/providers/thinking-options")
async def adhoc_thinking_options(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "参数非法"}, status_code=400)
    if (
        not isinstance(body, dict)
        or not body.get("baseUrl")
        or not body.get("apiKey")
        or not body.get("model")
    ):
        return JSONResponse({"error": "参数非法"}, status_code=400)
    protocol: ApiProtocol = body.get("protocol") or "openai"
    return await probe.fetch_thinking_options(
        protocol, body["baseUrl"], body["apiKey"], body["model"]
    )
