"""货币换算 + 展示货币选举（对齐 TS utils/currency.ts）。"""

from __future__ import annotations

DEFAULT_DISPLAY_CURRENCY = "CNY"
USD_RATE = 1.0

FALLBACK_RATES: dict[str, float] = {"USD": 1.0, "CNY": 7.0, "EUR": 0.92}


def convert_currency(
    amount: float,
    rates: dict[str, float],
    from_currency: str,
    to_currency: str,
) -> float:
    if from_currency == to_currency:
        return amount
    fr = rates.get(from_currency, FALLBACK_RATES.get(from_currency, USD_RATE))
    tr = rates.get(to_currency, FALLBACK_RATES.get(to_currency, USD_RATE))
    return amount / fr * tr


def pick_display_currency(currencies: list[str]) -> str:
    """数量多数者胜出，平票用 CNY（与 TS 语义一致：严格大于才更新）。"""
    if not currencies:
        return DEFAULT_DISPLAY_CURRENCY
    counts: dict[str, int] = {}
    for c in currencies:
        counts[c] = counts.get(c, 0) + 1
    best = DEFAULT_DISPLAY_CURRENCY
    best_count = 0
    for cur, cnt in counts.items():
        if cnt > best_count:
            best = cur
            best_count = cnt
    top = [c for c, n in counts.items() if n == best_count]
    if len(top) > 1:
        return DEFAULT_DISPLAY_CURRENCY
    return best


async def get_rates_with_fallback(fetch_rates) -> dict[str, float]:
    """拉取汇率，失败时返回固定兜底汇率。始终返回非空。"""
    try:
        return await fetch_rates()
    except Exception:
        return dict(FALLBACK_RATES)
