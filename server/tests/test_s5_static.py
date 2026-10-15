"""S5：静态托管与 SPA 回退（对齐 TS registerStaticOrVite）。

不走 lifespan（不用 with TestClient），静态路由纯 HTTP，无需 checkpointer。
"""

import json

import pytest
from fastapi.testclient import TestClient

from duet_langgraph.config import reset_config
from duet_langgraph.main import create_app


@pytest.fixture(autouse=True)
def _reset_config():
    reset_config()
    yield
    reset_config()


def _get(client: TestClient, path: str):
    resp = client.get(path)
    body = resp.text
    try:
        body = json.loads(body)
    except Exception:
        pass
    return resp.status_code, resp.headers.get("content-type", ""), body


def test_dev_root_message(monkeypatch):
    monkeypatch.setenv("DUET_ENV", "development")
    client = TestClient(create_app())
    code, ct, body = _get(client, "/")
    assert code == 200 and "json" in ct
    assert body["message"].startswith("后端运行于开发模式")


def test_production_without_build_shows_hint(monkeypatch, tmp_path):
    monkeypatch.setenv("DUET_ENV", "production")
    monkeypatch.setenv("DUET_STATIC_DIR", str(tmp_path))  # 空目录：无 index.html
    client = TestClient(create_app())
    code, _, body = _get(client, "/")
    assert code == 200
    assert "尚未构建" in body["error"]


def test_production_serves_spa(monkeypatch, tmp_path):
    monkeypatch.setenv("DUET_ENV", "production")
    monkeypatch.setenv("DUET_STATIC_DIR", str(tmp_path))
    (tmp_path / "index.html").write_text("<html>duet-ui</html>", encoding="utf-8")
    (tmp_path / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    client = TestClient(create_app())

    code, ct, body = _get(client, "/")
    assert code == 200 and "text/html" in ct and "duet-ui" in body

    # 命中真实静态文件
    code, _, _ = _get(client, "/favicon.svg")
    assert code == 200

    # SPA 回退：未知前端路由回 index.html
    code, ct, body = _get(client, "/session/abc123")
    assert code == 200 and "text/html" in ct and "duet-ui" in body

    # /api 未命中保持 404 JSON（不回退）
    code, ct, body = _get(client, "/api/nonexistent")
    assert code == 404 and "json" in ct
