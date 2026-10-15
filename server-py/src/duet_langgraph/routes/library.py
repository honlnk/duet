"""资产库路由（对齐 TS routes/library.ts）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..store import library

router = APIRouter()


def _upsert_response(e: Exception) -> JSONResponse:
    status = 404 if isinstance(e, LookupError) else 400
    return JSONResponse({"error": str(e)}, status_code=status)


# --------------------------- 角色模板 ---------------------------


@router.get("/api/templates/characters")
async def list_characters() -> list[dict]:
    return library.list_character_templates()


@router.post("/api/templates/characters")
async def create_character(request: Request):
    body = await request.json()
    try:
        return library.upsert_character_template(body)
    except (ValueError, LookupError) as e:
        return _upsert_response(e)


@router.put("/api/templates/characters/{id_}")
async def update_character(id_: str, request: Request):
    body = await request.json()
    try:
        return library.upsert_character_template({**body, "id": id_})
    except (ValueError, LookupError) as e:
        return _upsert_response(e)


@router.delete("/api/templates/characters/{id_}")
async def delete_character(id_: str):
    if not library.delete_character_template(id_):
        return JSONResponse({"error": "角色模板不存在"}, status_code=404)
    return {"ok": True}


# --------------------------- 话题模板 ---------------------------


@router.get("/api/templates/topics")
async def list_topics() -> list[dict]:
    return library.list_topic_templates()


@router.post("/api/templates/topics")
async def create_topic(request: Request):
    body = await request.json()
    try:
        return library.upsert_topic_template(body)
    except (ValueError, LookupError) as e:
        return _upsert_response(e)


@router.put("/api/templates/topics/{id_}")
async def update_topic(id_: str, request: Request):
    body = await request.json()
    try:
        return library.upsert_topic_template({**body, "id": id_})
    except (ValueError, LookupError) as e:
        return _upsert_response(e)


@router.delete("/api/templates/topics/{id_}")
async def delete_topic(id_: str):
    if not library.delete_topic_template(id_):
        return JSONResponse({"error": "话题模板不存在"}, status_code=404)
    return {"ok": True}


# --------------------------- 世界观模板 ---------------------------


@router.get("/api/templates/worldviews")
async def list_worldviews() -> list[dict]:
    return library.list_worldview_templates()


@router.post("/api/templates/worldviews")
async def create_worldview(request: Request):
    body = await request.json()
    try:
        return library.upsert_worldview_template(body)
    except (ValueError, LookupError) as e:
        return _upsert_response(e)


@router.put("/api/templates/worldviews/{id_}")
async def update_worldview(id_: str, request: Request):
    body = await request.json()
    try:
        return library.upsert_worldview_template({**body, "id": id_})
    except (ValueError, LookupError) as e:
        return _upsert_response(e)


@router.delete("/api/templates/worldviews/{id_}")
async def delete_worldview(id_: str):
    if not library.delete_worldview_template(id_):
        return JSONResponse({"error": "世界观模板不存在"}, status_code=404)
    return {"ok": True}


# --------------------------- 关系 + 迁移导入 ---------------------------


@router.get("/api/relationships")
async def get_relationships() -> dict:
    return library.get_relationships()


@router.put("/api/relationships")
async def put_relationships(request: Request) -> dict:
    body = await request.json()
    library.set_relationships(body.get("relationships") or {}, body.get("nodePositions"))
    return library.get_relationships()


@router.get("/api/library/status")
async def library_status() -> dict:
    return {"empty": library.library_is_empty()}


@router.post("/api/library/import")
async def import_library_route(request: Request) -> dict:
    body: dict[str, Any] = await request.json()
    return library.import_library(body)
