"""应用入口：create_app 工厂 + 控制台入口 duet-langgraph。

- 开发：uvicorn duet_langgraph.main:app --port 23892
- 生产：duet-langgraph（控制台入口，DUET_ENV 默认 production）
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from . import __version__
from .config import get_config
from .graph.chat_graph import close_checkpointer, get_checkpointer
from .routes import agent, exchange, health, library, pricing, providers, sessions
from .store import providers as provider_store
from .store import session_store
from .ws import chat_ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动恢复：running 会话 → stopped（reason=crashed），避免僵尸会话
    session_store.recover_sessions()
    provider_store.validate_providers()
    await get_checkpointer()
    yield
    await close_checkpointer()


def create_app() -> FastAPI:
    app = FastAPI(
        title="duet-langgraph",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(providers.router)
    app.include_router(sessions.router)
    app.include_router(library.router)
    app.include_router(pricing.router)
    app.include_router(exchange.router)
    app.include_router(agent.router)
    app.include_router(chat_ws.router)
    return app


# 开发模式：uvicorn duet_langgraph.main:app
app = create_app()


def main() -> None:
    """PyPI 控制台入口：duet-langgraph。"""
    os.environ.setdefault("DUET_ENV", "production")
    cfg = get_config()
    uvicorn.run(create_app(), host="0.0.0.0", port=cfg.port, log_level="info")
