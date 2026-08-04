/**
 * 前端全局汇率服务 —— 三层降级获取 + 跨币种换算。
 *
 * 与后端 utils/currency.ts 逻辑对齐，供 ProviderPanel 等组件复用。
 *
 * 三层降级（从上到下）：
 *   1. 后端返回最新汇率（后端自身有 6h 新鲜缓存 + 陈旧降级）→ 缓存到 localStorage
 *   2. 接口失败但有 localStorage 陈旧缓存（跨页面刷新存活）→ 降级使用
 *   3. 都没有 → 固定兜底汇率 7:1（与后端 FALLBACK_RATES 一致）
 */

import { fetchExchangeRates } from '@/services/api'

const STORAGE_KEY = 'duet:exchange-rates'

/**
 * 固定兜底汇率（各货币对 USD 的比率）。
 * 与后端 server/src/utils/currency.ts 的 FALLBACK_RATES 保持一致。
 * 用于接口不可用且无任何缓存时的最底层兜底。
 */
export const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  CNY: 7,
  EUR: 0.92,
}

/** 模块级内存缓存（同一次页面会话内复用） */
let memCache: Record<string, number> | null = null

/** 从 localStorage 读取陈旧缓存 */
function loadStale(): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { rates?: Record<string, number> }
    return parsed.rates ?? null
  } catch {
    return null
  }
}

/** 写入 localStorage（供后续降级使用） */
function saveToStorage(rates: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rates, savedAt: Date.now() }))
  } catch {
    /* 配额满或禁用存储，忽略 */
  }
}

/**
 * 获取汇率表，三层降级，始终返回非空：
 *   1. 调后端 /api/exchange-rates（后端已处理 6h 新鲜 + 陈旧降级）
 *   2. 接口失败 → localStorage 陈旧缓存
 *   3. 都没有 → FALLBACK_RATES
 */
export async function getRates(): Promise<Record<string, number>> {
  // 内存缓存命中（同一次会话已拉过）
  if (memCache) return memCache

  // 第 1 层：后端接口
  try {
    const res = await fetchExchangeRates()
    memCache = res.rates
    saveToStorage(res.rates)
    return res.rates
  } catch {
    // 落到降级
  }

  // 第 2 层：localStorage 陈旧缓存（跨刷新存活）
  const stale = loadStale()
  if (stale) {
    memCache = stale
    return stale
  }

  // 第 3 层：固定兜底汇率
  return FALLBACK_RATES
}

/**
 * 把金额从 fromCurrency 换算到 toCurrency。
 * 与后端 convertCurrency 逻辑一致：经 USD 中转，缺失汇率时查兜底表。
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
  // 缺失汇率时退化：先查兜底表，再没有当 USD(1) 处理
  const fr = fromRate ?? FALLBACK_RATES[fromCurrency] ?? 1
  const tr = toRate ?? FALLBACK_RATES[toCurrency] ?? 1
  return (amount / fr) * tr
}
