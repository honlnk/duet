"""测试基座：每测试隔离 DATA_DIR + 干净的 store 单例 + 图单例重置。"""

from __future__ import annotations

import asyncio
import os

import pytest
from fastapi.testclient import TestClient

from duet_langgraph.agent import messages as agent_messages
from duet_langgraph.config import reset_config
from duet_langgraph.graph.chat_graph import reset_graph_for_test
from duet_langgraph.main import create_app
from duet_langgraph.store import library as library_store
from duet_langgraph.store import session_store


@pytest.fixture()
def client(tmp_path):
    os.environ["DATA_DIR"] = str(tmp_path)
    reset_config()
    session_store._reset_for_test()
    library_store._reset_for_test()
    agent_messages._reset_for_test()
    with TestClient(create_app()) as c:
        yield c
    session_store._reset_for_test()
    library_store._reset_for_test()
    agent_messages._reset_for_test()
    # 图/checkpointer 是进程级单例且绑定了本次测试的 DATA_DIR，必须丢弃
    #（连接已由 lifespan 关闭，这里主要清 _compiled 缓存）
    asyncio.run(reset_graph_for_test())
