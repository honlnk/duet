"""测试基座：每测试隔离 DATA_DIR + 干净的 store 单例。"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from duet_langgraph.config import reset_config
from duet_langgraph.main import create_app
from duet_langgraph.store import library as library_store
from duet_langgraph.store import session_store


@pytest.fixture()
def client(tmp_path):
    os.environ["DATA_DIR"] = str(tmp_path)
    reset_config()
    session_store._reset_for_test()
    library_store._reset_for_test()
    with TestClient(create_app()) as c:
        yield c
    session_store._reset_for_test()
    library_store._reset_for_test()
