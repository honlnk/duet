import config from '../config.js'

/**
 * 估算成本（美元）。仅作展示参考，以 DeepSeek 实际账单为准。
 * @param inputTokens 输入 token 数
 * @param outputTokens 输出 token 数
 */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  const inCost = (inputTokens / 1_000_000) * config.costInputPerMTok
  const outCost = (outputTokens / 1_000_000) * config.costOutputPerMTok
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000
}
