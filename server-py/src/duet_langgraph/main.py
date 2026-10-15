"""应用入口：create_app 工厂 + 控制台入口 duet-langgraph。

- 开发：uvicorn duet_langgraph.main:app --port 23892（前端走 vite dev server）
- 生产：duet-langgraph（控制台入口，DUET_ENV 默认 production，托管 web 构建产物）
"""

from __future__ import annotations

import os
import webbrowser
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

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
    # 退出冲刷：仍在 running 的会话落盘为 stopped（reason=shutdown），与 TS 优雅退出一致
    session_store.recover_sessions(reason="shutdown")
    await close_checkpointer()


class SPAStaticFiles(StaticFiles):
    """SPA 回退：GET 未命中静态文件时回 index.html（/api、/ws 已被更早注册的路由接管）。

    Starlette 的 StaticFiles 未命中时抛 HTTPException(404)（由 FastAPI 转 JSON），
    早期版本则返回 404 响应 —— 两种形态都兜住。
    """

    async def get_response(self, path: str, scope):
        # /api、/ws 未命中路由时保持 404，不做 SPA 回退（对齐 TS notFoundHandler）
        spa_ok = scope["method"] == "GET" and not path.startswith(("api/", "ws/"))

        try:
            response = await super().get_response(path, scope)
            if response.status_code == 404 and spa_ok:
                response = await super().get_response("index.html", scope)
            return response
        except HTTPException as exc:
            if exc.status_code == 404 and spa_ok:
                return await super().get_response("index.html", scope)
            raise


def _register_static(app: FastAPI) -> None:
    """静态托管：对齐 TS registerStaticOrVite。

    - 开发：/ 返回提示 JSON，前端由 vite dev server 提供
    - 生产：托管 static_dir（缺 index.html 时返回构建提示）
    """
    cfg = get_config()
    if cfg.env != "production":
        dev_message = {
            "message": "后端运行于开发模式，仅提供 API/WebSocket。前端请访问 vite dev server。"
        }
        app.get("/")(lambda: JSONResponse(dev_message))
        return

    if not (cfg.static_dir / "index.html").is_file():
        app.get("/")(
            lambda: JSONResponse(
                {"error": "前端尚未构建，生产模式无法托管。请先运行 `pnpm build`。"}
            )
        )
        return

    # 挂在最后：API/WS 路由优先匹配，其余 GET 走静态 + SPA 回退
    app.mount("/", SPAStaticFiles(directory=cfg.static_dir), name="static")


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
    _register_static(app)
    return app


# 开发模式：uvicorn duet_langgraph.main:app
app = create_app()


def main() -> None:
    """PyPI 控制台入口：duet-langgraph。"""
    os.environ.setdefault("DUET_ENV", "production")
    cfg = get_config()
    # 与 TS 一致：生产模式启动后自动打开浏览器；无图形环境（Docker/远程）下静默忽略
    url = f"http://localhost:{cfg.port}"
    if (cfg.static_dir / "index.html").is_file():
        import threading

        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(create_app(), host="0.0.0.0", port=cfg.port, log_level="info")
