/**
 * 汇率查询路由。
 *
 * 代理调用 open.er-api.com（免费、无需 key），返回各货币对 USD 的汇率。
 * 采用 stale-while-error 缓存策略（三层降级）：
 *   1. 6h 内缓存（新鲜）→ 直接返回
 *   2. 超过 6h 的陈旧缓存（刷新失败但有历史记录）→ 降级返回旧缓存
 *   3. 无缓存且接口不可用 → 抛错，由调用方走固定兜底汇率（见 utils/currency.ts）
 *
 * fetchRates 同时被后端成本核算（utils/currency.ts）复用，
 * 用于多 Provider 混合货币场景下的统一换算。
 */
import type { FastifyInstance } from 'fastify'

const ER_API_URL = 'https://open.er-api.com/v6/latest/USD'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 小时

interface ErApiResponse {
  result: string
  base_code: string
  rates?: Record<string, number>
  time_next_update_unix?: number
}

/** 汇率缓存（含陈旧降级数据；fetchedAt 为成功获取的时间） */
let cache: { rates: Record<string, number>; fetchedAt: number } | null = null

/**
 * 从上游拉取最新汇率（无缓存逻辑，纯网络请求）。
 * 成功后更新 cache。
 */
async function refreshFromUpstream(): Promise<Record<string, number>> {
  const resp = await fetch(ER_API_URL, {
    headers: { 'User-Agent': 'Duet-Chat/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`汇率服务返回 ${resp.status}`)
  }
  const json = (await resp.json()) as ErApiResponse
  if (json.result !== 'success' || !json.rates) {
    throw new Error('汇率数据格式异常')
  }
  cache = { rates: json.rates, fetchedAt: Date.now() }
  return json.rates
}

/**
 * 获取汇率表（各货币对 USD 的比率），三层降级：
 *   1. 缓存新鲜（6h 内）→ 直接返回
 *   2. 缓存过期 → 尝试刷新；刷新成功返回新值；刷新失败且有旧缓存 → 返回旧缓存
 *   3. 无缓存且刷新失败 → 抛错（让调用方走固定兜底汇率）
 *
 * 同时供后端成本核算复用。
 */
export async function fetchRates(): Promise<Record<string, number>> {
  // 第 1 层：新鲜缓存
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rates
  }
  // 第 2 层：尝试刷新，失败降级到陈旧缓存
  try {
    return await refreshFromUpstream()
  } catch (e) {
    // 有陈旧缓存则降级返回（不丢弃）
    if (cache) {
      return cache.rates
    }
    // 第 3 层：无缓存，抛错让调用方走兜底
    throw e
  }
}

async function exchangeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/exchange-rates', async (_req, reply) => {
    try {
      const rates = await fetchRates()
      return { base: 'USD', rates }
    } catch (e) {
      return reply
        .code(502)
        .send({ error: e instanceof Error ? e.message : '获取汇率失败' })
    }
  })
}

export default exchangeRoutes
