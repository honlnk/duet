"""会话路由（对齐 TS routes/sessions.ts，含计划外发现的 5 条子资源路由）。"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..schemas import MAX_CHARACTERS, MIN_CHARACTERS, PRESET_COLORS, dump_session, gen_id, now_ms
from ..store import prompt_history, session_store
from ..ws import runtime as ws_runtime

router = APIRouter()

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$")

SESSION_CONFIG_KEYS = {
    "maxRounds",
    "durationSec",
    "model",
    "temperature",
    "summaryEveryN",
    "keepRecent",
    "providerA",
    "providerB",
    "providerC",
    "characterProviders",
    "thinkingA",
    "thinkingB",
    "thinkingC",
    "characterThinking",
    "scenario",
    "pacingEnabled",
    "pacingBufferRounds",
    "scheduling",
}


def _validate_color(c: Any) -> str | None:
    if not c or not isinstance(c, str):
        return None
    if c in PRESET_COLORS:
        return c
    if _HEX_COLOR_RE.fullmatch(c):
        return c.lower()
    return None


def _validate_characters(raw: Any) -> list[dict[str, Any]] | None:
    if not isinstance(raw, list):
        return None
    if not (MIN_CHARACTERS <= len(raw) <= MAX_CHARACTERS):
        return None
    out = []
    for a in raw:
        if not isinstance(a, dict) or not isinstance(a.get("name"), str) or not a["name"]:
            return None
        out.append(
            {
                "name": a["name"],
                "description": a.get("description"),
                "personality": a.get("personality"),
                "color": _validate_color(a.get("color")),
            }
        )
    return out


def _load_or_404(id_: str):
    session = session_store.load_session(id_)
    if session is None:
        return None, JSONResponse({"error": "会话不存在"}, status_code=404)
    return session, None


@router.post("/api/sessions")
async def create_session(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "参数非法"}, status_code=400)
    if not isinstance(body, dict) or not body.get("topic"):
        return JSONResponse({"error": "参数非法"}, status_code=400)

    raw_characters = body.get("characters") or body.get("agents") or []
    if not isinstance(raw_characters, list) or not (
        MIN_CHARACTERS <= len(raw_characters) <= MAX_CHARACTERS
    ):
        return JSONResponse(
            {"error": f"characters 数量须在 {MIN_CHARACTERS}~{MAX_CHARACTERS} 之间"},
            status_code=400,
        )
    characters = _validate_characters(raw_characters)
    if characters is None:
        return JSONResponse({"error": "参数非法"}, status_code=400)

    config = body.get("config") or {}
    if not isinstance(config, dict) or any(k not in SESSION_CONFIG_KEYS for k in config):
        return JSONResponse({"error": "参数非法"}, status_code=400)

    relationships = body.get("relationships")
    if relationships is not None and not (
        isinstance(relationships, dict)
        and all(isinstance(v, str) for v in relationships.values())
    ):
        return JSONResponse({"error": "参数非法"}, status_code=400)

    session = session_store.create_session(
        topic=body["topic"],
        characters=characters,
        config=config,
        relationships=relationships,
    )
    session_store.save_session(session)
    return dump_session(session)


@router.get("/api/sessions")
async def list_sessions() -> dict:
    return {"sessions": session_store.list_sessions()}


@router.get("/api/sessions/{id_}")
async def get_session(id_: str):
    session, err = _load_or_404(id_)
    if err:
        return err
    return dump_session(session)


@router.delete("/api/sessions/{id_}")
async def delete_session(id_: str):
    if not session_store.delete_session(id_):
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    prompt_history.clear_prompts(id_)
    return {"ok": True}


@router.patch("/api/sessions/{id_}/relationships")
async def patch_relationships(id_: str, request: Request):
    session, err = _load_or_404(id_)
    if err:
        return err
    body = await request.json()

    if "relationships" in body:
        session.relationships = body["relationships"] or {}
        for a in session.characters:
            if a.id in session.memory:
                session.memory[a.id].relationships = session.relationships
        ws_runtime.sync_relationships_to_runtime(id_, session.relationships)
    if "nodePositions" in body:
        from ..schemas import NodePosition

        session.node_positions = {
            k: NodePosition.model_validate(v) for k, v in (body["nodePositions"] or {}).items()
        }
    session_store.save_session(session)
    return dump_session(session)


@router.post("/api/sessions/{id_}/directors")
async def add_director(id_: str, request: Request):
    session, err = _load_or_404(id_)
    if err:
        return err
    body = await request.json()
    content = (body.get("content") or "").strip() if isinstance(body, dict) else ""
    if not content:
        return JSONResponse({"error": "参数非法"}, status_code=400)
    duration = body.get("durationRounds")
    if duration is not None and (not isinstance(duration, int) or duration < 0):
        return JSONResponse({"error": "参数非法"}, status_code=400)

    from ..schemas import DirectorInstruction

    director = DirectorInstruction(
        id=gen_id(),
        content=content,
        added_at=now_ms(),
        added_round=session_store.current_round(session),
        duration_rounds=duration or 0,
    )
    session.directors.append(director)
    session_store.save_session(session)
    ws_runtime.sync_directors_to_runtime(id_, session.directors)
    ws_runtime.broadcast(
        id_, {"type": "director_added", "director": director.model_dump(by_alias=True)}
    )
    return dump_session(session)


@router.delete("/api/sessions/{id_}/directors/{iid}")
async def remove_director(id_: str, iid: str):
    session, err = _load_or_404(id_)
    if err:
        return err
    before = len(session.directors)
    session.directors = [d for d in session.directors if d.id != iid]
    if len(session.directors) == before:
        return JSONResponse({"error": "导演指令不存在"}, status_code=404)
    session_store.save_session(session)
    ws_runtime.sync_directors_to_runtime(id_, session.directors)
    ws_runtime.broadcast(id_, {"type": "director_removed", "directorId": iid})
    return dump_session(session)


@router.patch("/api/sessions/{id_}/config")
async def patch_config(id_: str, request: Request):
    session, err = _load_or_404(id_)
    if err:
        return err
    body = await request.json()
    if "pacingEnabled" in body:
        session.config.pacing_enabled = body["pacingEnabled"]
    if "pacingBufferRounds" in body:
        session.config.pacing_buffer_rounds = body["pacingBufferRounds"]
    if "scheduling" in body:
        session.config.scheduling = body["scheduling"]
    session_store.save_session(session)
    ws_runtime.sync_config_to_runtime(
        id_,
        {
            "pacing_enabled": session.config.pacing_enabled,
            "pacing_buffer_rounds": session.config.pacing_buffer_rounds,
            "scheduling": session.config.scheduling,
        },
    )
    return dump_session(session)


@router.get("/api/sessions/{id_}/prompts")
async def get_prompts(id_: str, characterId: str | None = None, limit: str | None = None):
    session, err = _load_or_404(id_)
    if err:
        return err
    try:
        n = int(limit) if limit else None
    except ValueError:
        n = None
    if n is not None and n <= 0:
        n = None
    snapshots = prompt_history.get_prompts(id_, characterId, n or 20)
    return {"prompts": snapshots}
