/** 可选的单价覆盖（来自 Provider 配置） */
export interface CostRates {
  inputPerMTok: number
  outputPerMTok: number
}

/** 未指定 Provider 单价时的兜底参考价（美元/百万 token） */
const FALLBACK_INPUT_PER_MTOK = 0.27
const FALLBACK_OUTPUT_PER_MTOK = 1.10

/**
 * 估算成本（美元）。仅作展示参考，以实际账单为准。
 * @param inputTokens 输入 token 数
 * @param outputTokens 输出 token 数
 * @param rates 单价覆盖（来自 Provider）；不传则用兜底参考价
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  rates?: CostRates
): number {
  const inRate = rates?.inputPerMTok ?? FALLBACK_INPUT_PER_MTOK
  const outRate = rates?.outputPerMTok ?? FALLBACK_OUTPUT_PER_MTOK
  const inCost = (inputTokens / 1_000_000) * inRate
  const outCost = (outputTokens / 1_000_000) * outRate
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000
}
