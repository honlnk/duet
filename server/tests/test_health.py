"""S0 门禁：health / config-limits 契约（字段与 TS 版逐字段对齐）。"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from duet_langgraph.config import reset_config
from duet_langgraph.main import create_app


def make_client(tmp_path, monkeypatch, providers_payload=None):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    reset_config()
    if providers_payload is not None:
        (tmp_path / "providers.json").write_text(
            json.dumps(providers_payload), encoding="utf-8"
        )
    return TestClient(create_app())


def test_health_shape_empty(tmp_path, monkeypatch):
    client = make_client(tmp_path, monkeypatch)
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {
        "status",
        "ts",
        "env",
        "providerCount",
        "hasDefaultProvider",
        "limits",
    }
    assert body["status"] == "ok"
    assert isinstance(body["ts"], int)
    assert body["providerCount"] == 0
    assert body["hasDefaultProvider"] is False
    assert body["limits"] == {"absoluteMaxRounds": 200, "absoluteMaxDurationSec": 7200}


def test_health_with_providers(tmp_path, monkeypatch):
    payload = {
        "providers": [
            {"id": "prov_1", "name": "DeepSeek", "protocol": "openai"},
            {"id": "prov_2", "name": "Claude", "protocol": "anthropic"},
        ],
        "defaultId": "prov_2",
    }
    client = make_client(tmp_path, monkeypatch, payload)
    body = client.get("/api/health").json()
    assert body["providerCount"] == 2
    assert body["hasDefaultProvider"] is True


def test_config_limits_shape(tmp_path, monkeypatch):
    payload = {"providers": [{"id": "prov_1", "protocol": "openai"}], "defaultId": "prov_1"}
    client = make_client(tmp_path, monkeypatch, payload)
    body = client.get("/api/config/limits").json()
    assert set(body.keys()) == {
        "absoluteMaxRounds",
        "absoluteMaxDurationSec",
        "defaultProviderId",
    }
    assert body["defaultProviderId"] == "prov_1"
