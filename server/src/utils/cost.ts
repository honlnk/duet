import type { DeepSeekUsage } from '../types/index.js'

/**
 * 计费单价（Provider 维度）。
 * - 输入（未命中）、输出为基础项；
 * - 缓存命中/写入为可选维度，由对应开关控制是否计入成本。
 */
export interface CostRates {
  /** 货币代码，仅用于展示，不参与计算 */
  currency: string
  inputPerMTok: number
  outputPerMTok: number
  cacheHitEnabled: boolean
  cacheHitPerMTok: number
  cacheWriteEnabled: boolean
  cacheWritePerMTok: number
}

/** 未指定 Provider 单价时的兜底参考价（CNY/百万 token） */
export const FALLBACK_INPUT_PER_MTOK = 0.27
export const FALLBACK_OUTPUT_PER_MTOK = 1.1

/**
 * 计算单次调用增量成本。
 *
 * 计费规则：
 * - 输入：有缓存拆分时按「未命中 token × input 单价」计；无拆分时按 prompt_tokens 全量计。
 * - 缓存命中：cacheHitEnabled 为真时，按「命中 token × cacheHit 单价」计（通常远低于 input）。
 * - 缓存写入：cacheWriteEnabled 为真时，按「写入 token × cacheWrite 单价」计（仅少数模型）。
 * - 输出：completion_tokens × output 单价。
 *
 * @param usage 该次调用返回的 usage（含缓存拆分字段，未提供时按全量输入计）
 * @param rates 该次调用所用 Provider 的单价
 * @returns 该次调用成本（不四舍五入，由累加方控制精度）
 */
export function estimateStepCost(usage: DeepSeekUsage, rates: CostRates): number {
  const hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? 0
  const write = usage.prompt_cache_write_tokens ?? 0
  const out = usage.completion_tokens ?? 0
  // 有缓存拆分时，输入按未命中计；无拆分（如非 DeepSeek 系）时按 prompt_tokens 全量计
  const inMiss = miss > 0 || hit > 0 ? miss : (usage.prompt_tokens ?? 0)

  let cost = 0
  cost += (inMiss / 1_000_000) * rates.inputPerMTok
  if (rates.cacheHitEnabled) {
    cost += (hit / 1_000_000) * rates.cacheHitPerMTok
  }
  if (rates.cacheWriteEnabled) {
    cost += (write / 1_000_000) * rates.cacheWritePerMTok
  }
  cost += (out / 1_000_000) * rates.outputPerMTok
  return cost
}

/** 保留 6 位小数（与原实现一致，避免浮点漂移） */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

/**
 * 计算累计成本（旧接口，保留向后兼容）。
 *
 * 注意：该接口不区分缓存命中，仅用于无缓存场景或迁移过渡。
 * 新代码应使用「增量累加」：每次调用 estimateStepCost 后累加到 session.stats.estCost。
 *
 * @param inputTokens 输入 token 数
 * @param outputTokens 输出 token 数
 * @param rates 单价覆盖（来自 Provider）；不传则用兜底参考价
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  rates?: Partial<Pick<CostRates, 'inputPerMTok' | 'outputPerMTok'>>
): number {
  const inRate = rates?.inputPerMTok ?? FALLBACK_INPUT_PER_MTOK
  const outRate = rates?.outputPerMTok ?? FALLBACK_OUTPUT_PER_MTOK
  const inCost = (inputTokens / 1_000_000) * inRate
  const outCost = (outputTokens / 1_000_000) * outRate
  return round6(inCost + outCost)
}

export { round6 }
