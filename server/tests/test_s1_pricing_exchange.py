"""S1 契约测试：pricing / exchange（mock 上游，不触网）。"""

from __future__ import annotations

from duet_langgraph.routes import exchange, pricing


def test_pricing_match_and_shape(client, monkeypatch):
    fake = [
        {"id": "deepseek/deepseek-v4-flash", "pricing": {"prompt": "0.00000027", "completion": "0.0000011", "input_cache_read": "0.00000007"}},
        {"id": "deepseek/deepseek-v4-flash:free", "pricing": {"prompt": "0", "completion": "0"}},
        {"id": "openai/o3-mini-2025-01-31", "pricing": {"prompt": "0.0000011", "completion": "0.0000044"}},
    ]

    async def fake_fetch():
        return fake

    monkeypatch.setattr(pricing, "_fetch_openrouter_models", fake_fetch)

    # 标准版优先于 :free
    res = client.get("/api/pricing/deepseek-v4-flash")
    body = res.json()
    assert body["found"] is True
    assert body["matchedId"] == "deepseek/deepseek-v4-flash"
    assert set(body["pricing"].keys()) == {
        "inputPerMTok", "outputPerMTok", "cacheHitPerMTok",
        "cacheWritePerMTok", "hasCacheHit", "hasCacheWrite",
    }
    assert body["pricing"]["inputPerMTok"] == 0.27
    assert body["pricing"]["hasCacheWrite"] is False

    # 无匹配
    assert client.get("/api/pricing/no-such-model").json() == {"found": False}


def test_pricing_upstream_error(client, monkeypatch):
    async def boom():
        raise RuntimeError("OpenRouter 返回 500")

    monkeypatch.setattr(pricing, "_fetch_openrouter_models", boom)
    res = client.get("/api/pricing/any")
    assert res.status_code == 502
    assert res.json()["found"] is False


def test_exchange_rates(client, monkeypatch):
    async def fake_rates():
        return {"USD": 1.0, "CNY": 7.1}

    monkeypatch.setattr(exchange, "fetch_rates", fake_rates)
    res = client.get("/api/exchange-rates")
    assert res.json() == {"base": "USD", "rates": {"USD": 1.0, "CNY": 7.1}}
