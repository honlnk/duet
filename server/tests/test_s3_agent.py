"""S3 契约测试：导演 Agent —— 12 工具、Agent 图循环、6 种 SSE 事件。"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessageChunk, HumanMessage, SystemMessage, ToolMessage

from duet_langgraph.agent import messages as agent_messages
from duet_langgraph.agent import query as agent_query

# ============================== fake 模型 ==============================


class FakeAgentModel:
    """按 turns 脚本出牌：dict = 一轮回复（content 分片出 delta + tool_calls），Exception = 抛错。"""

    def __init__(self, turns: list):
        self.turns = list(turns)
        self.bound_tools = None
        self.seen: list[list] = []

    def bind_tools(self, tools):
        self.bound_tools = tools
        return self

    async def astream(self, messages):
        self.seen.append(list(messages))
        msg = self.turns.pop(0)
        if isinstance(msg, Exception):
            raise msg
        calls = msg.get("tool_calls")
        if calls:
            yield AIMessageChunk(
                content=msg.get("content", ""),
                tool_calls=[{"name": c["name"], "args": c["args"], "id": c["id"]} for c in calls],
            )
            return
        content = msg.get("content", "")
        for i in range(0, len(content), 2):
            yield AIMessageChunk(content=content[i : i + 2])


@pytest.fixture()
def fake_agent_model(monkeypatch):
    holder = SimpleNamespace(model=None, calls=0)

    def _make(provider, temperature, max_tokens, thinking=None):
        holder.calls += 1
        assert holder.model is not None, "测试未装配 fake 模型"
        return holder.model

    monkeypatch.setattr(agent_query, "make_model", _make)
    return holder


def parse_sse(text: str) -> list[dict]:
    events = []
    for block in text.strip().split("\n\n"):
        ev: dict = {}
        for line in block.split("\n"):
            if line.startswith("event: "):
                ev["event"] = line[len("event: ") :]
            elif line.startswith("data: "):
                ev["data"] = json.loads(line[len("data: ") :])
        if ev:
            events.append(ev)
    return events


def add_provider(client) -> dict:
    res = client.post(
        "/api/providers",
        json={
            "name": "DeepSeek",
            "baseUrl": "https://api.deepseek.com/v1",
            "apiKey": "sk-abcdef123456",
            "model": "deepseek-v4-flash",
        },
    )
    return res.json()["providers"][0]


def chat(client, prov, text, session_id="agent-s1", model="deepseek-v4-flash", thinking=None, chat_id=None):
    return client.post(
        "/api/agent/chat",
        json={
            "sessionId": session_id,
            "text": text,
            "providerId": prov["id"],
            "model": model,
            **({"thinking": thinking} if thinking else {}),
            **({"chatId": chat_id} if chat_id else {}),
        },
    )


def tool_call(name, args, cid="call_1"):
    return {"tool_calls": [{"name": name, "args": args, "id": cid}]}


# ============================== SSE 全链路 ==============================


def test_agent_tool_roundtrip_and_sse_contract(client, fake_agent_model):
    prov = add_provider(client)
    fake_agent_model.model = FakeAgentModel(
        [
            tool_call(
                "upsert_character_template",
                {"name": "小张", "description": "大学生，爱打篮球", "personality": "热心"},
            ),
            {"content": "已创建角色模板「小张」。需要再建一个角色才能开对话。"},
        ]
    )

    res = chat(client, prov, "帮我建一个角色：小张")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(res.text)
    seq = [(e["event"], e["data"]) for e in events]

    # 契约：tool_call → tool_result(mutated) → delta×n → assistant → done(completed)
    assert [e for e, _ in seq][0] == "tool_call"
    tool_call_ev = seq[0][1]
    assert tool_call_ev["name"] == "upsert_character_template"
    assert "新建角色模板「小张」" in tool_call_ev["summary"]
    tool_result_ev = seq[1][1]
    assert seq[1][0] == "tool_result"
    assert tool_result_ev["ok"] is True and tool_result_ev["mutated"] is True
    assert "已创建" in tool_result_ev["summary"]
    assert seq[-2] == ("assistant", {"content": "已创建角色模板「小张」。需要再建一个角色才能开对话。"})
    assert seq[-1] == ("done", {"reason": "completed"})
    deltas = "".join(d["text"] for e, d in seq if e == "delta")
    assert deltas == "已创建角色模板「小张」。需要再建一个角色才能开对话。"

    # 工具真实改了资产库（与 REST 同一 store —— mutated 联动）
    chars = client.get("/api/templates/characters").json()
    assert len(chars) == 1 and chars[0]["name"] == "小张"
    # 工具表确实绑定给了模型（12 个）
    assert len(fake_agent_model.model.bound_tools) == 12

    # 第二次请求复用同一会话态：system 提示词只注入一次
    fake_agent_model.model = FakeAgentModel([{"content": "收到"}])
    res2 = chat(client, prov, "谢谢", session_id="agent-s1")
    assert parse_sse(res2.text)[-1] == {"event": "done", "data": {"reason": "completed"}}
    msgs = agent_messages.get_agent_session("agent-s1")
    assert msgs[0].__class__ is SystemMessage
    assert sum(isinstance(m, HumanMessage) for m in msgs) == 2


def test_agent_unknown_tool_and_validation_feedback(client, fake_agent_model):
    prov = add_provider(client)
    fake_agent_model.model = FakeAgentModel(
        [
            tool_call("no_such_tool", {}),
            tool_call("upsert_character_template", {}),  # 缺 name → 校验失败
            {"content": "已处理"},
        ]
    )
    res = chat(client, prov, "随便调点工具")
    seq = [(e["event"], e["data"]) for e in parse_sse(res.text)]

    unknown = seq[0]
    assert unknown[0] == "tool_call" and unknown[1]["name"] == "no_such_tool"
    assert seq[1][0] == "tool_result" and seq[1][1]["ok"] is False
    assert "未知工具" in seq[1][1]["summary"] and seq[1][1]["mutated"] is False

    invalid = seq[2]
    assert invalid[0] == "tool_call" and invalid[1]["name"] == "upsert_character_template"
    assert seq[3][0] == "tool_result" and seq[3][1]["ok"] is False
    assert "参数校验失败" in seq[3][1]["summary"]
    assert seq[-1] == ("done", {"reason": "completed"})

    # 失败不崩循环：库无残留
    assert client.get("/api/templates/characters").json() == []


def test_agent_turn_limit(client, fake_agent_model):
    prov = add_provider(client)
    # 每轮都发起工具调用 → 30 轮安全阀
    fake_agent_model.model = _AlwaysToolModel()
    res = chat(client, prov, "不停列表")
    events = parse_sse(res.text)
    assert events[-1] == {"event": "done", "data": {"reason": "turn_limit"}}
    assert sum(1 for e in events if e["event"] == "tool_call") == 30


def _AlwaysToolModel():
    return FakeAgentModel(
        [tool_call("list_character_templates", {})] * 40
    )


def test_agent_llm_error_surfaced(client, fake_agent_model):
    prov = add_provider(client)
    fake_agent_model.model = FakeAgentModel([RuntimeError("upstream boom")])
    res = chat(client, prov, "hello")
    events = parse_sse(res.text)
    assert events == [
        {"event": "error", "data": {"message": "upstream boom"}},
        {"event": "done", "data": {"reason": "error"}},
    ]


def test_agent_provider_404(client):
    res = client.post(
        "/api/agent/chat",
        json={"sessionId": "s", "text": "hi", "providerId": "prov_none", "model": "m"},
    )
    assert res.status_code == 404
    assert res.json() == {"error": "Provider 不存在"}


def test_agent_body_validation(client):
    res = client.post("/api/agent/chat", json={"sessionId": "s", "text": "hi"})
    assert res.status_code == 422


# ============================== abort 语义（直调 run_agent_query） ==============================


class _Prov:
    """run_agent_query 只读 Provider 字段。"""

    protocol = "openai"
    model = "deepseek-v4-flash"
    api_key = "sk-x"
    base_url = "https://api.deepseek.com/v1"
    thinking_config = None


async def test_agent_abort_before_start(fake_agent_model, tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    events = []
    abort = asyncio.Event()
    abort.set()
    fake_agent_model.model = FakeAgentModel([{"content": "不应被调用"}])  # 若被调用会 pop 光报错

    final = await agent_query.run_agent_query(
        messages=[HumanMessage(content="hi")],
        provider=_Prov(),  # type: ignore[arg-type]
        thinking=None,
        on_event=events.append,
        abort=abort,
    )
    assert events == [{"type": "done", "reason": "aborted"}]
    assert fake_agent_model.calls == 0
    assert len(final) == 1  # 消息未追加


async def test_agent_abort_skips_rest_of_tool_batch(fake_agent_model, tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from duet_langgraph.store import library as library_store

    library_store._reset_for_test()
    fake_agent_model.model = FakeAgentModel(
        [
            {
                "tool_calls": [
                    {"name": "list_character_templates", "args": {}, "id": "c1"},
                    {"name": "list_topic_templates", "args": {}, "id": "c2"},
                ]
            },
        ]
    )
    events = []
    abort = asyncio.Event()

    def on_event(e):
        events.append(e)
        if e["type"] == "tool_result":  # 第一个工具执行完 → 停止
            abort.set()

    final = await agent_query.run_agent_query(
        messages=[HumanMessage(content="hi")],
        provider=_Prov(),  # type: ignore[arg-type]
        thinking=None,
        on_event=on_event,
        abort=abort,
    )
    kinds = [e["type"] for e in events]
    # c1 正常执行；c2 被跳过（无事件）；回到 agent_step 时 abort → done
    assert kinds == ["tool_call", "tool_result", "done"]
    assert events[-1]["reason"] == "aborted"
    tools = [m for m in final if isinstance(m, ToolMessage)]
    assert tools[0].tool_call_id == "c1"
    assert tools[1].tool_call_id == "c2"
    assert tools[1].content == "已因用户停止而跳过该工具"
    library_store._reset_for_test()


def test_library_ids_are_clean(client):
    """回归：_gen_id 曾把 random.choices 的列表 repr 拼进 id（脏 id 进库）。"""
    import re

    from duet_langgraph.store import library

    for _ in range(3):  # 连建三个，同毫秒内也须靠随机后缀区分且格式干净
        t = library.upsert_character_template(
            {"id": "", "name": "测试", "description": "d", "personality": "p"}
        )
        assert re.fullmatch(r"ct_[0-9a-z]+", t["id"]), f"脏 id: {t['id']!r}"
        library.delete_character_template(t["id"])


# ============================== 聊天历史持久化 ==============================


def test_agent_chat_history_crud(client, fake_agent_model):
    """带 chatId 的对话增量落盘（user/tool/assistant），可列表/详情/删除；不带则维持纯内存。"""
    prov = add_provider(client)
    fake_agent_model.model = FakeAgentModel(
        [
            tool_call(
                "upsert_character_template",
                {"name": "小张", "description": "d", "personality": "p"},
            ),
            {"content": "已创建角色模板「小张」。"},
        ]
    )
    res = chat(client, prov, "帮我建一个角色：小张", session_id="hist-1", chat_id="hist-1")
    assert res.status_code == 200
    assert [e["event"] for e in parse_sse(res.text)][-1] == "done"

    # 不带 chatId 的旧用法：不落盘
    fake_agent_model.model = FakeAgentModel([{"content": "好"}])
    assert chat(client, prov, "hi", session_id="ephemeral").status_code == 200

    lst = client.get("/api/agent/chats").json()
    assert [c["id"] for c in lst] == ["hist-1"]
    summary = lst[0]
    assert summary["title"].startswith("帮我建一个角色")
    assert summary["messageCount"] == 3  # user + tool + assistant

    detail = client.get("/api/agent/chats/hist-1").json()
    kinds = [m["kind"] for m in detail["messages"]]
    assert kinds == ["user", "tool", "assistant"]
    tool_msg = detail["messages"][1]
    assert tool_msg["name"] == "upsert_character_template"
    assert tool_msg["ok"] is True and tool_msg["mutated"] is True
    assert tool_msg["args"]["name"] == "小张"
    assert detail["messages"][2]["content"] == "已创建角色模板「小张」。"

    assert client.delete("/api/agent/chats/hist-1").json() == {"ok": True}
    assert client.get("/api/agent/chats/hist-1").status_code == 404
    assert client.delete("/api/agent/chats/hist-1").status_code == 404
    assert client.get("/api/agent/chats").json() == []


def test_agent_chat_history_context_rebuild(client, fake_agent_model):
    """内存会话过期后（TTL 清空），带 chatId 续聊从落盘历史重建上下文。"""
    prov = add_provider(client)
    fake_agent_model.model = FakeAgentModel([{"content": "第一轮回答"}])
    assert chat(client, prov, "第一轮问题", session_id="s2", chat_id="hist-2").status_code == 200

    agent_messages._reset_for_test()  # 模拟 2h TTL 过期/进程重启
    fake_agent_model.model = FakeAgentModel([{"content": "第二轮回答"}])
    assert chat(client, prov, "第二轮问题", session_id="s2", chat_id="hist-2").status_code == 200

    # 第二轮模型收到的上下文须含第一轮的 user/assistant 文本（system 之后）
    seen = fake_agent_model.model.seen[0]
    texts = [str(m.content) for m in seen]
    assert "第一轮问题" in texts and "第一轮回答" in texts
    assert texts.index("第一轮问题") < texts.index("第一轮回答")

    # 历史按时间新→旧，第二轮后仍是同一个 chat
    detail = client.get("/api/agent/chats/hist-2").json()
    assert [m["kind"] for m in detail["messages"]] == ["user", "assistant"] * 2


def test_agent_chat_history_newest_first(client, fake_agent_model):
    prov = add_provider(client)
    for sid, text in [("old", "旧对话"), ("new", "新对话")]:
        fake_agent_model.model = FakeAgentModel([{"content": f"回:{text}"}])
        assert chat(client, prov, text, session_id=sid, chat_id=sid).status_code == 200
    lst = client.get("/api/agent/chats").json()
    assert [c["id"] for c in lst] == ["new", "old"]
