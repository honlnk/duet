"""图编译与 checkpointer（SqliteSaver，thread_id = sessionId）。

checkpoint 存 DATA_DIR/checkpoints.db —— 与 sessions_meta（duet.db）分库：
SQLite 单写者，两个独立写入方（事件循环线程的同步连接 + checkpointer 的
aiosqlite 工作线程）共用一个文件会跨线程写锁互卡（实测 database is locked）。
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from ..config import get_config
from . import nodes
from .state import DuetState

logger = logging.getLogger(__name__)

_compiled: Any | None = None
_checkpointer: BaseCheckpointSaver | None = None
_saver_conn: Any | None = None


async def get_checkpointer() -> BaseCheckpointSaver:
    """惰性创建 AsyncSqliteSaver（进程内单例）。"""
    global _checkpointer, _saver_conn
    if _checkpointer is None:
        import aiosqlite
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        db_path = get_config().data_root / "checkpoints.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _saver_conn = await aiosqlite.connect(str(db_path))
        await _saver_conn.execute("PRAGMA journal_mode=WAL")
        await _saver_conn.execute("PRAGMA busy_timeout=5000")
        _checkpointer = AsyncSqliteSaver(_saver_conn)
        await _checkpointer.setup()
    return _checkpointer


async def close_checkpointer() -> None:
    global _checkpointer, _saver_conn
    if _saver_conn is not None:
        await _saver_conn.close()
        _saver_conn = None
        _checkpointer = None


async def get_compiled_graph():
    """编译主对话图（结构静态，进程内单例）。"""
    global _compiled
    if _compiled is None:
        builder = StateGraph(DuetState)
        builder.add_node("check_stop", nodes.check_stop)
        builder.add_node("summarize_memory", nodes.summarize_memory)
        builder.add_node("build_context", nodes.build_context)
        builder.add_node("character_reply", nodes.character_reply)
        builder.add_node("post_reply", nodes.post_reply)
        builder.add_node("select_speaker", nodes.select_speaker)
        builder.add_node("finish", nodes.finish)

        builder.add_edge(START, "check_stop")
        builder.add_conditional_edges(
            "check_stop",
            nodes.route_after_check,
            {"finish": "finish", "summarize_memory": "summarize_memory"},
        )
        builder.add_edge("summarize_memory", "build_context")
        builder.add_edge("build_context", "character_reply")
        builder.add_edge("character_reply", "post_reply")
        builder.add_edge("post_reply", "select_speaker")
        builder.add_edge("select_speaker", "check_stop")
        builder.add_edge("finish", END)

        _compiled = builder.compile(checkpointer=await get_checkpointer())
    return _compiled


async def reset_graph_for_test() -> None:
    """仅测试用：丢弃编译缓存与 checkpointer 连接。"""
    global _compiled
    _compiled = None
    await close_checkpointer()
