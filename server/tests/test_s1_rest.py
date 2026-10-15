"""S1 契约测试：providers / library / sessions 全路由。"""

from __future__ import annotations

# ============================== providers ==============================


def test_provider_crud_roundtrip(client):
    created = client.post(
        "/api/providers",
        json={"name": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1", "apiKey": "sk-abcdef123456", "model": "deepseek-v4-flash"},
    )
    assert created.status_code == 200
    body = created.json()
    assert set(body.keys()) == {"providers", "defaultId"}
    item = body["providers"][0]
    assert set(item.keys()) == {"id", "name", "baseUrl", "model", "protocol", "pricing", "apiKeyMasked"}
    assert item["apiKeyMasked"] == "sk-***3456"
    assert item["protocol"] == "openai"
    assert set(item["pricing"].keys()) == {
        "currency", "inputPerMTok", "outputPerMTok",
        "cacheHitEnabled", "cacheHitPerMTok", "cacheWriteEnabled", "cacheWritePerMTok",
    }
    # 第一条自动设为默认
    assert body["defaultId"] == item["id"]
    pid = item["id"]

    # apiKey 空字符串 = 不修改
    client.put(f"/api/providers/{pid}", json={"apiKey": "", "model": "deepseek-v4-pro"})
    after = client.get("/api/providers").json()
    assert after["providers"][0]["model"] == "deepseek-v4-pro"
    detail = client.get("/api/health").json()
    assert detail["providerCount"] == 1

    # 默认 Provider 不可删
    resp = client.delete(f"/api/providers/{pid}")
    assert resp.status_code == 400
    assert "默认" in resp.json()["error"]

    # 第二条 + 设默认 + 删旧
    second = client.post(
        "/api/providers",
        json={"name": "Claude", "baseUrl": "https://api.anthropic.com", "apiKey": "sk-ant-xxxxxx9999", "model": "claude-x", "protocol": "anthropic"},
    ).json()["providers"][1]
    ok = client.put(f"/api/providers/default/{second['id']}")
    assert ok.status_code == 200
    assert ok.json()["defaultId"] == second["id"]
    assert client.delete(f"/api/providers/{pid}").status_code == 200

    # 不存在
    assert client.put("/api/providers/default/prov_none").status_code == 404
    assert client.put("/api/providers/prov_none", json={"name": "x"}).status_code == 404


def test_provider_thinking_options_openai_heuristic(client):
    pid = client.post(
        "/api/providers",
        json={"name": "OAI", "baseUrl": "https://api.openai.com/v1", "apiKey": "sk-1234567890", "model": "o3-mini"},
    ).json()["providers"][0]["id"]
    res = client.post(f"/api/providers/{pid}/thinking-options")
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"supported", "options", "providerDefault"}
    assert body["supported"] is True
    assert [o["key"] for o in body["options"]][:2] == ["none", "minimal"]


# ============================== library ==============================


def test_library_contract(client):
    assert client.get("/api/library/status").json() == {"empty": True}

    ct = client.post("/api/templates/characters", json={"name": "小美", "description": "同桌", "personality": "文静"})
    assert set(ct.json().keys()) == {"id", "name", "description", "personality", "createdAt"}
    cid = ct.json()["id"]

    other = client.post("/api/templates/characters", json={"name": "小张"}).json()["id"]
    tt = client.post("/api/templates/topics", json={"content": "周末计划"})
    assert set(tt.json().keys()) == {"id", "content", "createdAt"}
    wt = client.post("/api/templates/worldviews", json={"name": "校园", "scenario": "高中"})
    assert set(wt.json().keys()) == {"id", "name", "scenario", "createdAt"}

    # 关系整体覆盖 + 读取
    rel = client.put(
        "/api/relationships",
        json={
            "relationships": {f"{cid}->{other}": "暗恋"},
            "nodePositions": {cid: {"x": 1, "y": 2}},
        },
    )
    assert set(rel.json().keys()) == {"relationships", "nodePositions"}

    # 级联删除：删角色模板 → 关系与坐标一并清理
    assert client.delete(f"/api/templates/characters/{cid}").json() == {"ok": True}
    after = client.get("/api/relationships").json()
    assert after["relationships"] == {}
    assert after["nodePositions"] == {}

    # 更新 404 / 删除 404
    assert client.put("/api/templates/characters/ct_none", json={"name": "x"}).status_code == 404
    assert client.delete("/api/templates/characters/ct_none").status_code == 404


def test_library_import_idempotent(client):
    payload = {
        "characterTemplates": [{"id": "ct_a", "name": "A", "description": "", "personality": "", "createdAt": 1}],
        "relationships": {"ct_a->ct_b": "朋友"},
    }
    first = client.post("/api/library/import", json=payload).json()
    assert set(first.keys()) == {"characters", "topics", "worldviews", "relationships"}
    client.post("/api/library/import", json=payload)  # 幂等：重复导入
    assert len(client.get("/api/templates/characters").json()) == 1
    assert client.get("/api/library/status").json() == {"empty": False}


# ============================== sessions ==============================


def make_session(client, **overrides):
    payload = {
        "topic": "AI 立法",
        "characters": [
            {"name": "支持者", "description": "伦理学家", "personality": "坚定"},
            {"name": "反对者"},
        ],
    }
    payload.update(overrides)
    return client.post("/api/sessions", json=payload)


SESSION_KEYS = {
    "id", "topic", "characters", "config", "status", "finishedReason",
    "startedAt", "stoppedAt", "messageCount", "currentCharacterId",
    "messages", "memory", "stats", "error", "createdAt", "updatedAt",
    "relationships", "directors",
}
CONFIG_KEYS = {
    "maxRounds", "durationSec", "model", "temperature", "summaryEveryN",
    "keepRecent", "pacingEnabled", "pacingBufferRounds",
}
STATS_KEYS = {
    "totalPromptTokens", "totalCompletionTokens", "totalTokens",
    "totalCacheHitTokens", "totalCacheMissTokens", "totalCacheWriteTokens",
    "estCost", "costCurrency", "totalChars",
}


def test_session_create_contract(client):
    res = make_session(client)
    assert res.status_code == 200
    s = res.json()
    assert set(s.keys()) == SESSION_KEYS
    # 四个状态字段恒出现且为 null
    assert s["finishedReason"] is None and s["startedAt"] is None
    assert s["stoppedAt"] is None and s["error"] is None
    assert s["status"] == "idle"
    assert s["messageCount"] == 0
    assert s["currentCharacterId"] == "A"
    assert s["relationships"] == {}
    assert s["directors"] == []
    # characters：description/personality 省略式可选
    assert set(s["characters"][0].keys()) == {"id", "name", "description", "personality", "color"}
    assert set(s["characters"][1].keys()) == {"id", "name", "color"}
    assert s["characters"][0]["id"] == "A"
    assert s["characters"][0]["color"] == "blue"
    assert s["characters"][1]["color"] == "pink"
    # config 默认值（对齐 TS defaultConfig）
    assert set(s["config"].keys()) == CONFIG_KEYS
    assert s["config"]["temperature"] == 0.7
    assert s["config"]["summaryEveryN"] == 10
    assert s["config"]["keepRecent"] == 8
    assert s["config"]["pacingEnabled"] is True
    assert s["config"]["pacingBufferRounds"] == 2
    # memory：每角色一份，含 others / relationships
    assert set(s["memory"].keys()) == {"A", "B"}
    assert set(s["memory"]["A"].keys()) == {
        "character", "others", "topic", "messages", "summary",
        "lastSummarizedRound", "relationships",
    }
    assert s["memory"]["A"]["character"]["id"] == "A"
    assert [o["id"] for o in s["memory"]["A"]["others"]] == ["B"]
    assert set(s["stats"].keys()) == STATS_KEYS


def test_session_list_get_delete_and_validations(client):
    s = make_session(client).json()
    lst = client.get("/api/sessions").json()
    assert set(lst.keys()) == {"sessions"}
    item = lst["sessions"][0]
    assert set(item.keys()) == {
        "id", "topic", "status", "messageCount", "updatedAt", "createdAt", "characters"
    }
    assert item["characters"] == ["支持者", "反对者"]

    assert client.get(f"/api/sessions/{s['id']}").json()["id"] == s["id"]
    assert client.get("/api/sessions/sess_none").status_code == 404
    assert client.delete(f"/api/sessions/{s['id']}").status_code == 200

    # 数量校验（1 个角色 → 400）
    assert make_session(client, characters=[{"name": "独"}]).status_code == 400
    # 兼容旧字段名 agents
    ok = client.post(
        "/api/sessions",
        json={"topic": "旧字段", "agents": [{"name": "A1"}, {"name": "B1"}]},
    )
    assert ok.status_code == 200
    # 非法颜色 → 忽略并回退默认色（不是 400）
    s2 = make_session(client, characters=[{"name": "X", "color": "not-a-color"}, {"name": "Y"}]).json()
    assert s2["characters"][0]["color"] == "blue"
    # 合法 hex 颜色保留（小写化）
    s3 = make_session(client, characters=[{"name": "X", "color": "#FF5533"}, {"name": "Y"}]).json()
    assert s3["characters"][0]["color"] == "#ff5533"


def test_session_relationships_patch(client):
    s = make_session(client).json()
    res = client.patch(
        f"/api/sessions/{s['id']}/relationships",
        json={"relationships": {"A->B": "朋友"}, "nodePositions": {"A": {"x": 0, "y": 1}}},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["relationships"] == {"A->B": "朋友"}
    assert body["nodePositions"] == {"A": {"x": 0, "y": 1}}
    # memory 里的 relationships 同步
    assert body["memory"]["A"]["relationships"] == {"A->B": "朋友"}


def test_session_directors(client):
    s = make_session(client).json()
    res = client.post(f"/api/sessions/{s['id']}/directors", json={"content": "转入新话题", "durationRounds": 3})
    assert res.status_code == 200
    d = res.json()["directors"][0]
    assert set(d.keys()) == {"id", "content", "addedAt", "addedRound", "durationRounds"}
    assert d["addedRound"] == 0 and d["durationRounds"] == 3

    # 空 content → 400
    assert client.post(f"/api/sessions/{s['id']}/directors", json={"content": " "}).status_code == 400
    # 删除
    assert client.delete(f"/api/sessions/{s['id']}/directors/{d['id']}").status_code == 200
    assert client.delete(f"/api/sessions/{s['id']}/directors/{d['id']}").status_code == 404


def test_session_config_patch_and_prompts(client):
    s = make_session(client).json()
    res = client.patch(f"/api/sessions/{s['id']}/config", json={"pacingEnabled": False, "pacingBufferRounds": 5})
    assert res.json()["config"]["pacingEnabled"] is False
    assert res.json()["config"]["pacingBufferRounds"] == 5

    res = client.get(f"/api/sessions/{s['id']}/prompts")
    assert res.json() == {"prompts": []}
    assert client.get("/api/sessions/sess_none/prompts").status_code == 404


def test_session_recovery(client):
    from duet_langgraph.store import session_store as store

    s = make_session(client).json()
    # 手动把会话置为 running 再触发恢复
    session = store.load_session(s["id"])
    session.status = "running"
    store.save_session(session)
    store._reset_for_test()  # 丢弃连接模拟重启
    n = store.recover_sessions()
    assert n == 1
    recovered = store.load_session(s["id"])
    assert recovered.status == "stopped"
    assert recovered.finished_reason == "crashed"
