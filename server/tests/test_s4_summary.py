"""S4 契约测试：摘要触发/注入/裁剪、usage 三维缓存断言、scheduling=llm。"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage

from duet_langgraph.graph import nodes
from duet_langgraph.memory import summarizer
from duet_langgraph.ws import chat_ws

# ============================== fake 模型 ==============================


class ChatModel:
    """对话模型：usage 携带三维缓存计数。"""

    def __init__(self, replies: list[str]):
        self.replies = list(replies)

    async def astream(self, messages):
        text = self.replies.pop(0) if self.replies else "默认回复"
        yield _Chunk(text[:1])
        yield _Chunk(
            text[1:],
            usage={
                "prompt_tokens": 100,
                "completion_tokens": 40,
                "prompt_cache_hit_tokens": 60,
                "prompt_cache_write_tokens": 10,
            },
        )


class _Chunk:
    def __init__(self, content, usage=None):
        self.content = content
        self.response_metadata = {"usage": usage} if usage else {}
        self.usage_metadata = None


class SummaryModel:
    """摘要模型：ainvoke 一次。"""

    def __init__(self, content="这是第一人称视角的摘要。", fail=False):
        self.content = content
        self.fail = fail
        self.calls: list = []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        if self.fail:
            raise RuntimeError("summary upstream down")
        return AIMessage(
            content=self.content,
            response_metadata={
                "usage": {"prompt_tokens": 50, "completion_tokens": 20, "prompt_cache_hit_tokens": 5}
            },
        )


@pytest.fixture()
def fake_models(monkeypatch):
    chat_holder = SimpleNamespace(model=None)
    summary_holder = SimpleNamespace(model=None)

    monkeypatch.setattr(
        nodes, "make_model", lambda provider, temperature, max_tokens, thinking=None: chat_holder.model
    )
    monkeypatch.setattr(
        summarizer, "make_model", lambda provider, temperature, max_tokens, thinking=None: summary_holder.model
    )
    return SimpleNamespace(chat=chat_holder, summary=summary_holder)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    async def _rates():
        return {"USD": 7.0}

    monkeypatch.setattr(chat_ws, "fetch_rates", _rates)


def add_provider(client) -> None:
    client.post(
        "/api/providers",
        json={
            "name": "DeepSeek",
            "baseUrl": "https://api.deepseek.com/v1",
            "apiKey": "sk-abcdef123456",
            "model": "deepseek-v4-flash",
        },
    )


def recv_until(ws, type_: str, limit=500, allow_error=False):
    events = []
    for _ in range(limit):
        ev = json.loads(ws.receive_text())
        events.append(ev)
        if ev["type"] == type_:
            return events, ev
        if ev["type"] == "error" and not allow_error:
            raise AssertionError(f"意外 error 事件: {ev}")
    raise AssertionError("等待超时")


def send(ws, msg):
    ws.send_text(json.dumps(msg, ensure_ascii=False))


# ============================== 摘要 ==============================


def test_summary_trims_and_injects(client, fake_models):
    add_provider(client)
    # keepRecent=2 + summaryEveryN=1 → 每个角色记忆一旦超过 2 条就摘要
    s = client.post(
        "/api/sessions",
        json={
            "topic": "AI 立法",
            "characters": [{"name": "支持者"}, {"name": "反对者"}],
            "config": {"keepRecent": 2, "summaryEveryN": 1, "maxRounds": 3},
        },
    ).json()
    sid = s["id"]
    fake_models.chat.model = ChatModel(["好的", "不好", "再说", "同意", "结束", "收尾"])
    fake_models.summary.model = SummaryModel("支持者视角：讨论了立法利弊。")

    with client.websocket_connect(f"/ws/chat?sessionId={sid}") as ws:
        json.loads(ws.receive_text())  # sync
        send(ws, {"type": "start"})
        events, _ = recv_until(ws, "finished")

    summaries = [e for e in events if e["type"] == "summary"]
    assert len(summaries) >= 1
    first = summaries[0]
    assert first["phase"] == "start" and first["characterId"] in ("A", "B")
    done = next(e for e in summaries if e["phase"] == "done")
    assert done["summary"] == "支持者视角：讨论了立法利弊。"
    assert done["characterId"] == first["characterId"]

    got = client.get(f"/api/sessions/{sid}").json()
    cid = first["characterId"]
    mem = got["memory"][cid]
    # 摘要裁剪：trim 到 keepRecent 后、下次摘要前又累积一轮对话 → 上限 keepRecent + 角色数
    #（无摘要将是 7 条：opening + 6 条对话）
    assert len(mem["messages"]) <= 4
    assert mem["summary"] == "支持者视角：讨论了立法利弊。"
    assert mem["lastSummarizedRound"] > 0

    # 摘要注入后续请求：该角色的 prompt 快照里出现摘要注入 system 消息
    prompts = client.get(f"/api/sessions/{sid}/prompts", params={"characterId": cid}).json()["prompts"]
    injected_prompts = [
        p
        for p in prompts
        if any(
            m["role"] == "system" and "对话进展摘要" in m["content"] for m in p["messages"]
        )
    ]
    assert injected_prompts, "摘要后该角色的请求应包含摘要注入"
    assert any("支持者视角" in m["content"] for m in injected_prompts[0]["messages"])


def test_summary_error_non_fatal(client, fake_models):
    add_provider(client)
    s = client.post(
        "/api/sessions",
        json={
            "topic": "AI 立法",
            "characters": [{"name": "甲"}, {"name": "乙"}],
            "config": {"keepRecent": 1, "summaryEveryN": 1, "maxRounds": 2},
        },
    ).json()
    sid = s["id"]
    fake_models.chat.model = ChatModel(["一", "二", "三", "四"])
    fake_models.summary.model = SummaryModel(fail=True)

    with client.websocket_connect(f"/ws/chat?sessionId={sid}") as ws:
        json.loads(ws.receive_text())
        send(ws, {"type": "start"})
        events, finished = recv_until(ws, "finished")

    assert finished["reason"] == "max_rounds"
    err_events = [e for e in events if e["type"] == "summary" and e["phase"] == "error"]
    assert len(err_events) >= 1
    assert "summary upstream down" in err_events[0]["message"]
    got = client.get(f"/api/sessions/{sid}").json()
    assert got["messageCount"] == 4  # 对话未被摘要失败打断


# ============================== usage 三维 ==============================


def test_usage_three_dim_cache_accumulation(client, fake_models):
    add_provider(client)
    s = client.post(
        "/api/sessions",
        json={
            "topic": "计数",
            "characters": [{"name": "甲"}, {"name": "乙"}],
            "config": {"maxRounds": 1, "keepRecent": 2, "summaryEveryN": 1},
        },
    ).json()
    sid = s["id"]
    fake_models.chat.model = ChatModel(["一", "二"])
    fake_models.summary.model = SummaryModel("摘要内容。")

    with client.websocket_connect(f"/ws/chat?sessionId={sid}") as ws:
        json.loads(ws.receive_text())
        send(ws, {"type": "start"})
        events, _ = recv_until(ws, "finished")

    summaries = [e for e in events if e["type"] == "summary" and e["phase"] == "done"]
    n_summary = len(summaries)
    stats = client.get(f"/api/sessions/{sid}").json()["stats"]
    # 对话 2 次：prompt 200 / completion 80 / hit 120 / write 20；
    # 摘要 n 次：prompt 50n / completion 20n / hit 5n
    assert stats["totalPromptTokens"] == 200 + 50 * n_summary
    assert stats["totalCompletionTokens"] == 80 + 20 * n_summary
    assert stats["totalTokens"] == 280 + 70 * n_summary
    assert stats["totalCacheHitTokens"] == 120 + 5 * n_summary
    assert stats["totalCacheWriteTokens"] == 20
    # raw usage 无 miss 字段 → 0（miss 仅在 usage_metadata 回退路径计算）
    assert stats["totalCacheMissTokens"] == 0
    assert stats["costCurrency"] == "CNY"


# ============================== scheduling=llm ==============================


class _PickState:
    def __init__(self):
        self.calls = 0


async def test_llm_pick_speaker_parses_and_falls_back(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    from duet_langgraph.graph.state import CharacterLoopInfo, LoopRuntime, loop_ctx
    from duet_langgraph.schemas import (
        CharacterRef,
        Provider,
        ProviderPricing,
        Session,
        SessionConfig,
        SessionStats,
    )
    from duet_langgraph.utils.cost import CostRates

    prov = Provider(
        id="p1",
        name="x",
        base_url="https://x",
        api_key="k",
        model="m",
        pricing=ProviderPricing(
            input_per_m_tok=1, output_per_m_tok=1, cache_hit_per_m_tok=1, cache_write_per_m_tok=1
        ),
    )

    def make_session(scheduling=None):
        return Session(
            id="s1",
            topic="测试",
            characters=[CharacterRef(id="A", name="甲"), CharacterRef(id="B", name="乙"), CharacterRef(id="C", name="丙")],
            config=SessionConfig(scheduling=scheduling),
            status="running",
            message_count=2,
            current_character_id="A",
            messages=[],
            memory={},
            stats=SessionStats(),
            created_at=0,
            updated_at=0,
        )

    rates = CostRates(
        currency="CNY", input_per_m_tok=1, output_per_m_tok=1,
        cache_hit_enabled=True, cache_hit_per_m_tok=1,
        cache_write_enabled=True, cache_write_per_m_tok=1,
    )
    loop = LoopRuntime(session_id="s1")
    loop.characters["A"] = CharacterLoopInfo("A", "甲", prov, rates)
    loop.display_currency = "CNY"

    class PickModel:
        def __init__(self, content):
            self.content = content

        async def ainvoke(self, messages):
            return AIMessage(content=self.content, response_metadata={"usage": {"prompt_tokens": 9}})

    # 解析成功：输出 "下一位是 C" → C
    monkeypatch.setattr(nodes, "make_model", lambda *a, **k: PickModel("下一位是 C"))
    token = loop_ctx.set(loop)
    try:
        session = make_session()
        picked, usage = await nodes._llm_pick_speaker(session, "A")
        assert picked == "C"
        assert usage is not None and usage.prompt_tokens == 9

        # 解析失败：无合法字母 → 回落
        monkeypatch.setattr(nodes, "make_model", lambda *a, **k: PickModel("好的，稍等"))
        picked2, usage2 = await nodes._llm_pick_speaker(make_session(), "A")
        assert picked2 == "A" and usage2 is None

        # 模型错误 → 回落
        class Boom:
            async def ainvoke(self, messages):
                raise RuntimeError("nope")

        monkeypatch.setattr(nodes, "make_model", lambda *a, **k: Boom())
        picked3, usage3 = await nodes._llm_pick_speaker(make_session(), "A")
        assert picked3 == "A" and usage3 is None
    finally:
        loop_ctx.reset(token)


def test_scheduling_llm_overrides_round_robin(client, fake_models, monkeypatch):
    add_provider(client)
    # 3 角色：round-robin 顺序 A→B→C；llm 恒选 A → A→A→A→…
    s = client.post(
        "/api/sessions",
        json={
            "topic": "调度",
            "characters": [{"name": "甲"}, {"name": "乙"}, {"name": "丙"}],
            "config": {"maxRounds": 1, "scheduling": "llm"},
        },
    ).json()
    sid = s["id"]
    fake_models.chat.model = ChatModel(["一", "二", "三"])
    fake_models.summary.model = SummaryModel()

    calls = _PickState()

    async def fake_pick(session, fallback):
        calls.calls += 1
        return "A", None  # 恒选 A + 无 usage

    monkeypatch.setattr(nodes, "_llm_pick_speaker", fake_pick)

    with client.websocket_connect(f"/ws/chat?sessionId={sid}") as ws:
        json.loads(ws.receive_text())
        send(ws, {"type": "start"})
        events, _ = recv_until(ws, "finished")

    dones = [e["characterId"] for e in events if e["type"] == "message_done"]
    # 3 条消息全是 A；最后一轮后 about_to_finish 跳过选人 → 恰好 2 次 pick 调用
    assert dones == ["A", "A", "A"]
    assert calls.calls == 2
    got = client.get(f"/api/sessions/{sid}").json()
    assert got["config"]["scheduling"] == "llm"
