"""计费（对齐 TS utils/cost.ts）。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel

if TYPE_CHECKING:
    from ..schemas import NormalizedUsage

FALLBACK_INPUT_PER_MTOK = 0.27
FALLBACK_OUTPUT_PER_MTOK = 1.1


class CostRates(BaseModel):
    currency: str = "CNY"
    input_per_m_tok: float
    output_per_m_tok: float
    cache_hit_enabled: bool
    cache_hit_per_m_tok: float
    cache_write_enabled: bool
    cache_write_per_m_tok: float


def estimate_step_cost(usage: NormalizedUsage, rates: CostRates) -> float:
    """单次调用增量成本（与 TS estimateStepCost 同规则）。"""
    hit = usage.prompt_cache_hit_tokens or 0
    miss = usage.prompt_cache_miss_tokens or 0
    write = usage.prompt_cache_write_tokens or 0
    out = usage.completion_tokens or 0
    in_miss = miss if (miss > 0 or hit > 0) else (usage.prompt_tokens or 0)

    cost = 0.0
    cost += in_miss / 1_000_000 * rates.input_per_m_tok
    if rates.cache_hit_enabled:
        cost += hit / 1_000_000 * rates.cache_hit_per_m_tok
    if rates.cache_write_enabled:
        cost += write / 1_000_000 * rates.cache_write_per_m_tok
    cost += out / 1_000_000 * rates.output_per_m_tok
    return cost


def round6(n: float) -> float:
    return round(n * 1_000_000) / 1_000_000
