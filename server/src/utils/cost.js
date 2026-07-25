import config from '../config.js'

/**
 * 估算成本（美元）。仅作展示参考，以 DeepSeek 实际账单为准。
 * @param {number} inputTokens
 * @param {number} outputTokens
 */
export function estimateCost(inputTokens, outputTokens) {
  const inCost = (inputTokens / 1_000_000) * config.costInputPerMTok
  const outCost = (outputTokens / 1_000_000) * config.costOutputPerMTok
  return Math.round((inCost + outCost) * 1_000_000) / 1_000_000
}
