"""S2 契约测试：WS 15 事件中的主链路事件 + 主图循环语义（fake 模型）。"""

from __future__ import annotations

import asyncio
import json
import threading
from types import SimpleNamespace

import pytest
from starlette.websockets import WebSocketDisconnect

from duet_langgraph.graph import nodes
from duet_langgraph.ws import chat_ws

STATS_EVENT_KEYS = {
    "totalPromptTokens", "totalCompletionTokens", "totalTokens",
    "totalCacheHitTokens", "totalCacheMissTokens", "totalCacheWriteTokens",
    "estCost", "costCurrency", "totalChars",
}


# ============================== fake 模型 ==============================


class FakeChunk:
    def __init__(self, content: str, usage: dict | None = None):
        self.content = content
        self.response_metadata = {"usage": usage} if usage else {}
        self.usage_metadata = None


class FakeModel:
    """前 fail_times 次调用抛异常（测 retry），其余按 replies 顺序出词。"""

    def __init__(self, replies: list[str] | None = None, fail_times: int = 0):
        self.replies = list(replies or [])
        self.fail_times = fail_times
        self.calls = 0

    async def astream(self, messages):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise RuntimeError("boom")
        text = self.replies.pop(0) if self.replies else "默认回复内容"
        yield FakeChunk(text[:2])
        yield FakeChunk(text[2:], usage={"prompt_tokens": 10, "completion_tokens": 5})


class GatedModel:
    """第 gate_call 次调用阻塞在 threading.Event 上（跨线程可安全释放）。"""

    def __init__(self, gate: threading.Event, gate_call: int):
        self.gate = gate
        self.gate_call = gate_call
        self.calls = 0

    async def astream(self, messages):
        self.calls += 1
        if self.calls == self.gate_call:
            waited = 0
            while not self.gate.is_set():
                await asyncio.sleep(0.005)
                waited += 1
                if waited > 4000:
                    raise RuntimeError("gate 等待超时")
        yield FakeChunk(f"第{self.calls}条回复", usage={"prompt_tokens": 3, "completion_tokens": 2})


@pytest.fixture()
def fake_model(monkeypatch):
    holder = SimpleNamespace(model=None)

    def _make(provider, temperature, max_tokens, thinking=None):
        assert holder.model is not None, "测试未装配 fake 模型"
        return holder.model

    monkeypatch.setattr(nodes, "make_model", _make)
    return holder


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    async def _rates():
        return {"USD": 7.0}

    monkeypatch.setattr(chat_ws, "fetch_rates", _rates)


# ============================== 辅助 ==============================


def add_provider(client) -> str:
    res = client.post(
        "/api/providers",
        json={
            "name": "DeepSeek",
            "baseUrl": "https://api.deepseek.com/v1",
            "apiKey": "sk-abcdef123456",
            "model": "deepseek-v4-flash",
        },
    )
    return res.json()["providers"][0]["id"]


def make_session(client) -> dict:
    res = client.post(
        "/api/sessions",
        json={"topic": "AI 立法", "characters": [{"name": "支持者"}, {"name": "反对者"}]},
    )
    assert res.status_code == 200
    return res.json()


def recv_until(ws, type_: str, limit: int = 500, allow_error: bool = False):
    """收事件直到 type_ 出现；意外 error 事件立即失败（防死等挂起）。"""
    events: list[dict] = []
    for _ in range(limit):
        ev = json.loads(ws.receive_text())
        events.append(ev)
        if ev["type"] == type_:
            return events, ev
        if ev["type"] == "error" and not allow_error:
            raise AssertionError(f"收到意外 error 事件: {ev}\n此前事件: {events}")
    raise AssertionError(f"等待 {type_} 事件超时，已收到 {[e['type'] for e in events]}")


def send(ws, msg: dict) -> None:
    ws.send_text(json.dumps(msg, ensure_ascii=False))


# ============================== 连接协议 ==============================


def test_ws_sync_ping_pong_and_unknown(client):
    add_provider(client)
    s = make_session(client)
    with client.websocket_connect(f"/ws/chat?sessionId={s['id']}") as ws:
        sync = json.loads(ws.receive_text())
        assert sync["type"] == "sync"
        assert sync["session"]["id"] == s["id"]
        assert sync["session"]["messageCount"] == 0

        send(ws, {"type": "ping"})
        assert json.loads(ws.receive_text()) == {"type": "pong"}

        send(ws, {"type": "whatever"})
        err = json.loads(ws.receive_text())
        assert err["type"] == "error" and "未知消息类型" in err["message"]

        ws.send_text("not-json{")  # 非法 JSON 原文
        err = json.loads(ws.receive_text())
        assert err["type"] == "error" and "格式错误" in err["message"]

        send(ws, [1, 2])  # 合法 JSON 但非对象
        err = json.loads(ws.receive_text())
        assert err["type"] == "error" and "格式错误" in err["message"]


def test_ws_missing_session_id(client):
    with client.websocket_connect("/ws/chat") as ws:
        err = json.loads(ws.receive_text())
        assert err == {"type": "error", "message": "缺少 sessionId"}
        with pytest.raises(WebSocketDisconnect):
            ws.receive_text()  # 服务端已关闭


def test_ws_session_not_found(client):
    with client.websocket_connect("/ws/chat?sessionId=nope") as ws:
        err = json.loads(ws.receive_text())
        assert err["type"] == "error" and "会话不存在" in err["message"]
        send(ws, {"type": "start"})
        err2 = json.loads(ws.receive_text())
        assert err2["type"] == "error" and "会话不存在" in err2["message"]


# ============================== 主循环全链路 ==============================


def test_full_two_round_flow(client, fake_model):
    add_provider(client)
    s = make_session(client)
    sid = s["id"]
    fake_model.model = FakeModel(replies=["好的没问题", "我不同意", "换个角度想", "就此打住"])

    with client.websocket_connect(f"/ws/chat?sessionId={sid}") as ws:
        assert json.loads(ws.receive_text())["type"] == "sync"
        send(ws, {"type": "start", "maxRounds": 2})
        events, finished = recv_until(ws, "finished")

    types = [e["type"] for e in events]
    assert types[0] == "started"
    assert events[0]["startedAt"] > 0
    # 2 轮 × 2 角色
    assert types.count("message_done") == 4
    assert types.count("stats") == 4
    assert types.count("turn_end") == 4
    assert types[-1] == "finished"
    assert finished["reason"] == "max_rounds"
    # 轮转顺序 A→B→A→B
    dones = [e for e in events if e["type"] == "message_done"]
    assert [e["characterId"] for e in dones] == ["A", "B", "A", "B"]

    # chunk：内容拼接 == message_done 内容，且带 characterId
    msg0 = dones[0]["message"]
    chunks0 = "".join(
        e["content"] for e in events if e["type"] == "chunk" and e["characterId"] == "A"
    )
    assert msg0["content"] == "好的没问题"
    assert chunks0.startswith("好的")

    # message_done / stats / turn_end 契约键集
    assert set(msg0.keys()) == {"characterId", "role", "content", "ts", "tokens", "truncated"}
    assert msg0["role"] == "assistant" and msg0["truncated"] is False
    stats_ev = next(e for e in events if e["type"] == "stats")
    assert set(stats_ev.keys()) == {"type", *STATS_EVENT_KEYS}
    turn_ev = next(e for e in events if e["type"] == "turn_end")
    assert set(turn_ev.keys()) == {"type", "round", "messageCount"}

    # 落盘：会话终态 + 统计 + 记忆 + prompt 快照
    got = client.get(f"/api/sessions/{sid}").json()
    assert got["status"] == "finished"
    assert got["finishedReason"] == "max_rounds"
    assert got["messageCount"] == 4
    assert got["stoppedAt"] is not None
    assert len(got["messages"]) == 4
    assert [m["characterId"] for m in got["messages"]] == ["A", "B", "A", "B"]
    assert got["currentCharacterId"] == "A"  # 4 条后轮回起点
    # 4 × (10 prompt + 5 completion)
    assert got["stats"]["totalPromptTokens"] == 40
    assert got["stats"]["totalCompletionTokens"] == 20
    assert got["stats"]["totalTokens"] == 60
    assert got["stats"]["costCurrency"] == "CNY"

    # 记忆：A = 开场提示 + A1 + B1 + A2 + B2；B = A1 + B1 + A2 + B2
    mem_a = got["memory"]["A"]
    mem_b = got["memory"]["B"]
    assert len(mem_a["messages"]) == 5
    assert len(mem_b["messages"]) == 4
    assert [m["role"] for m in mem_a["messages"]] == [
        "user", "assistant", "user", "assistant", "user",
    ]
    # B 视角里 A 的发言带名字前缀
    assert mem_b["messages"][0]["content"].startswith("[支持者]:")
    assert mem_a["messages"][0]["content"] != ""  # 开场提示非空

    prompts = client.get(f"/api/sessions/{sid}/prompts").json()["prompts"]
    assert len(prompts) == 4
    assert prompts[0]["messages"][0]["role"] == "system"
    assert {p["characterId"] for p in prompts} == {"A", "B"}


def test_retry_then_success(client, fake_model, monkeypatch):
    monkeypatch.setattr(nodes, "RETRY_BASE_MS", 1)
    monkeypatch.setattr(nodes, "RETRY_CAP_MS", 4)
    add_provider(client)
    s = make_session(client)
    sid = s["id"]
    fake_model.model = FakeModel(replies=["重试成功", "收到"], fail_times=2)

    with client.websocket_connect(f"/ws/chat?sessionId={sid}") as ws:
        json.loads(ws.receive_text())  # sync
        send(ws, {"type": "start", "maxRounds": 1})
        events, _ = recv_until(ws, "finished")

    retries = [e for e in events if e["type"] == "retry"]
    assert [e["attempt"] for e in retries] == [1, 2]
    assert all(e["maxAttempts"] == 10 and e["delayMs"] >= 1 and "boom" in e["error"] for e in retries)
    assert [e["type"] for e in events][:4] == ["started", "retry", "retry", "chunk"]
    assert events[-1]["reason"] == "max_rounds"
    # 两次失败后成功 → 仍有 2 条消息
    got = client.get(f"/api/sessions/{sid}").json()
    assert got["messageCount"] == 2
    assert got["status"] == "finished"


def test_retry_exhaustion_sets_error(client, fake_model, monkeypatch):
    monkeypatch.setattr(nodes, "RETRY_BASE_MS", 1)
    monkeypatch.setattr(nodes, "RETRY_CAP_MS", 4)
    add_provider(client)
    s = make_session(client)
    sid = s["id"]
    fake_model.model = FakeModel(fail_times=99)

    with client.websocket_connect(f"/ws/chat?sessionId={sid}") as ws:
        json.loads(ws.receive_text())  # sync
        send(ws, {"type": "start", "maxRounds": 1})
        events, finished = recv_until(ws, "finished", allow_error=True)

    assert [e["type"] for e in events].count("retry") == 10
    error_ev = next(e for e in events if e["type"] == "error")
    assert "已重试 10 次" in error_ev["message"]
    assert finished["reason"] == "error"
    got = client.get(f"/api/sessions/{sid}").json()
    assert got["status"] == "error"
    assert got["error"] is not None and "已重试 10 次" in got["error"]
    assert got["messageCount"] == 0


# ============================== 停止语义 ==============================


def test_stop_graceful_after_current_turn(client, fake_model):
    add_provider(client)
    s = make_session(client)
    sid = s["id"]
    gate = threading.Event()
    fake_model.model = GatedModel(gate, gate_call=2)

    with client.websocket_connect(f"/ws/chat?sessionId={sid}") as ws:
        json.loads(ws.receive_text())  # sync
        send(ws, {"type": "start"})  # maxRounds=0 → 不限轮数
        events1, _ = recv_until(ws, "turn_end")  # A 说完

        send(ws, {"type": "stop"})
        stopping = json.loads(ws.receive_text())
        assert stopping == {"type": "stopping"}

        gate.set()  # 放行 B 的生成：当前发言完整说完，之后轮间隙生效
        rest, finished = recv_until(ws, "finished")

    all_events = events1 + [{"type": "stopping"}] + rest
    assert all_events[-1]["type"] == "finished"
    assert finished["reason"] == "stopped"
    assert sum(1 for e in all_events if e["type"] == "message_done") == 2

    got = client.get(f"/api/sessions/{sid}").json()
    assert got["status"] == "stopped"
    assert got["finishedReason"] == "stopped"
    assert got["messageCount"] == 2
    assert got["stoppedAt"] is not None
    # 可继续：重新 start 会开启新一轮
    assert got["currentCharacterId"] == "A"


def test_duplicate_start_rejected(client, fake_model):
    add_provider(client)
    s = make_session(client)
    sid = s["id"]
    gate = threading.Event()
    fake_model.model = GatedModel(gate, gate_call=1)

    with client.websocket_connect(f"/ws/chat?sessionId={sid}") as ws:
        json.loads(ws.receive_text())  # sync
        send(ws, {"type": "start", "maxRounds": 1})
        send(ws, {"type": "start", "maxRounds": 1})  # 循环尚未结束 → 拒绝
        gate.set()
        events, _ = recv_until(ws, "finished", allow_error=True)

    types = [e["type"] for e in events]
    assert types.count("started") == 1
    dup = [e for e in events if e["type"] == "error"]
    assert len(dup) == 1 and "已在运行中" in dup[0]["message"]
