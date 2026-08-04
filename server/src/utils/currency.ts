/**
 * 货币换算 + 展示货币选举。
 *
 * 多 Provider 混合货币场景下，各 Provider 的成本需统一折算到「展示货币」再累加。
 * 展示货币按会话中各 Provider 货币的**数量多数**决定，平票时用 CNY 兜底。
 *
 * 汇率数据源：open.er-api.com（各货币对 USD 的比率），由 exchange.ts 的 fetchRates 提供，
 * 带 6h 内存缓存。拉取失败时降级为固定兜底汇率（7:1，即 1 USD = 7 CNY）。
 */

import { fetchRates } from '../routes/exchange.js'

/**
 * 兜底汇率（各货币对 USD 的比率）。
 * 用于汇率接口不可用时降级计算，保证成本仍可累加（不裸加）。
 * 仅含项目支持的货币（CNY/USD/EUR）；其余货币退化为同币种（rate=1）。
 */
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  CNY: 7,
  EUR: 0.92,
}

/** 默认展示货币（选举平票 / 空集合时的兜底） */
export const DEFAULT_DISPLAY_CURRENCY = 'CNY'

/** USD 对自身的比率（基准） */
const USD_RATE = 1

/**
 * 把金额从 fromCurrency 换算到 toCurrency。
 * @param amount  原始金额
 * @param rates   各货币对 USD 的比率表（如 { USD:1, CNY:7.1, EUR:0.92 }）
 * @param fromCurrency  原始货币代码
 * @param toCurrency    目标货币代码
 */
export function convertCurrency(
  amount: number,
  rates: Record<string, number>,
  fromCurrency: string,
  toCurrency: string,
): number {
  if (fromCurrency === toCurrency) return amount
  const fromRate = rates[fromCurrency]
  const toRate = rates[toCurrency]
  // 缺失汇率时退化：同币种返回原值，异币种用 USD 中转兜底
  const fr = fromRate ?? FALLBACK_RATES[fromCurrency] ?? USD_RATE
  const tr = toRate ?? FALLBACK_RATES[toCurrency] ?? USD_RATE
  // 换算：先折成 USD（amount / fromRate），再折成目标币（× toRate）
  return (amount / fr) * tr
}

/**
 * 从一组货币代码中选出「展示货币」——数量占多数者胜出，平票用 CNY。
 *
 * @param currencies 各 Provider 的货币代码列表（如 ['CNY', 'USD', 'USD']）
 * @returns 展示货币代码
 */
export function pickDisplayCurrency(currencies: string[]): string {
  if (currencies.length === 0) return DEFAULT_DISPLAY_CURRENCY
  const counts = new Map<string, number>()
  for (const c of currencies) {
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best = DEFAULT_DISPLAY_CURRENCY
  let bestCount = 0
  // 遍历找最多；严格大于才更新（保证平票时保留先遇到的，且空时用 CNY）
  for (const [cur, cnt] of counts) {
    if (cnt > bestCount) {
      best = cur
      bestCount = cnt
    }
  }
  // 平票判定：最高票数是否唯一
  const topCount = bestCount
  const topCurrencies = [...counts.entries()].filter(([, c]) => c === topCount)
  if (topCurrencies.length > 1) {
    return DEFAULT_DISPLAY_CURRENCY
  }
  return best
}

/**
 * 拉取汇率表，失败时返回固定兜底汇率。
 * 始终返回非空，调用方无需处理异常。
 */
export async function getRatesWithFallback(): Promise<Record<string, number>> {
  try {
    return await fetchRates()
  } catch {
    return { ...FALLBACK_RATES }
  }
}
