/**
 * 汇率查询路由。
 *
 * 代理调用 open.er-api.com（免费、无需 key），返回各货币对 USD 的汇率。
 * 带 6 小时内存缓存（该数据源每日更新一次，无需频繁刷新）。
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

let cache: { rates: Record<string, number>; fetchedAt: number } | null = null

/**
 * 获取汇率表（各货币对 USD 的比率），带 6h 内存缓存。
 * 同时供后端成本核算复用。
 */
export async function fetchRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rates
  }
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
