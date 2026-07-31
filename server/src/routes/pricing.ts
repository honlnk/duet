/**
 * 模型价格查询路由。
 *
 * 代理调用 OpenRouter 的公开模型列表接口（GET /api/v1/models，无需鉴权），
 * 按 modelId 模糊匹配后返回归一化价格（美元/百万 token）。
 * 全量列表带 1 小时内存缓存，避免重复请求。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'

/** OpenRouter 模型列表返回结构（仅取用到的字段） */
interface OpenRouterModel {
  id: string
  pricing?: {
    prompt?: string // 每 token 美元（输入/未命中）
    completion?: string // 每 token 美元（输出）
    input_cache_read?: string // 缓存命中
    input_cache_write?: string // 缓存写入
  }
}

interface OpenRouterList {
  data?: OpenRouterModel[]
}

/** 查询返回的归一化价格（美元/百万 token） */
interface PricingResult {
  found: boolean
  matchedId?: string
  pricing?: {
    inputPerMTok: number
    outputPerMTok: number
    cacheHitPerMTok: number
    cacheWritePerMTok: number
    hasCacheHit: boolean
    hasCacheWrite: boolean
  }
}

/* ----------------------------- 缓存 ----------------------------- */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 小时

let cache: { models: OpenRouterModel[]; fetchedAt: number } | null = null

/** 拉取 OpenRouter 全量模型列表（带缓存） */
async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models
  }
  const resp = await fetch(OPENROUTER_URL, {
    headers: { 'User-Agent': 'Duet-Chat/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`OpenRouter 返回 ${resp.status}`)
  }
  const json = (await resp.json()) as OpenRouterList
  const models = Array.isArray(json.data) ? json.data : []
  cache = { models, fetchedAt: Date.now() }
  return models
}

/* ----------------------------- 匹配 ----------------------------- */

/** 去掉日期后缀：deepseek-v4-flash-0731 → deepseek-v4-flash */
function stripDateSuffix(id: string): string {
  return id.replace(/[-_](\d{4})?\d{2}\d{2}$/, '').replace(/-\d{8}$/, '')
}

/** 去掉 vendor 前缀：deepseek/deepseek-v4-flash → deepseek-v4-flash */
function basename(id: string): string {
  const idx = id.lastIndexOf('/')
  return idx >= 0 ? id.slice(idx + 1) : id
}

/**
 * 按 modelId 模糊匹配 OpenRouter 模型。
 * 匹配优先级：精确 basename > 去日期后缀包含 > 原始包含；
 * 优先选非 :free / :batch 的标准版。
 */
function matchModel(
  target: string,
  models: OpenRouterModel[]
): OpenRouterModel | undefined {
  const t = target.toLowerCase().trim()
  const tStripped = stripDateSuffix(t)

  // 是否标准版（排除 :free / :batch 等变体）
  const isStandard = (id: string) =>
    !/:free$|:batch$|:nitro$/.test(id.toLowerCase())

  // 候选收集：按匹配强度分级
  const candidates: Array<{ model: OpenRouterModel; score: number }> = []
  for (const m of models) {
    const id = m.id.toLowerCase()
    const base = basename(id)
    const baseStripped = stripDateSuffix(base)
    let score = 0
    if (base === t) score = 100 // 精确 basename
    else if (baseStripped === tStripped) score = 100 // 去日期后缀精确（等同精确，靠日期后缀加分胜出）
    else if (baseStripped.includes(tStripped) || tStripped.includes(baseStripped))
      score = 70 // 去日期后缀包含
    else if (id.includes(t) || t.includes(base)) score = 50 // 原始包含
    if (score > 0) {
      // 标准版加分；带日期后缀的版本加分（它是真实发布版，价格更准确）
      if (isStandard(id)) score += 10
      if (/\d{4}$/.test(base)) score += 3 // 末尾是日期（如 -0731）
      candidates.push({ model: m, score })
    }
  }
  if (candidates.length === 0) return undefined
  // 按分数降序取第一个
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]!.model
}

/** 把 OpenRouter 的"每 token 美元"字符串转成"每百万 token 美元"数字 */
function perTokToPerM(s: string | undefined): number {
  if (!s) return 0
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n * 1_000_000 : 0
}

/* ----------------------------- 路由 ----------------------------- */

async function pricingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/api/pricing/:modelId',
    async (req: FastifyRequest<{ Params: { modelId: string } }>, reply) => {
      const target = decodeURIComponent(req.params.modelId)
      try {
        const models = await fetchOpenRouterModels()
        const matched = matchModel(target, models)
        if (!matched || !matched.pricing) {
          return { found: false } satisfies PricingResult
        }
        const p = matched.pricing
        const cacheHit = perTokToPerM(p.input_cache_read)
        const cacheWrite = perTokToPerM(p.input_cache_write)
        return {
          found: true,
          matchedId: matched.id,
          pricing: {
            inputPerMTok: perTokToPerM(p.prompt),
            outputPerMTok: perTokToPerM(p.completion),
            cacheHitPerMTok: cacheHit,
            cacheWritePerMTok: cacheWrite,
            hasCacheHit: cacheHit > 0,
            hasCacheWrite: cacheWrite > 0,
          },
        } satisfies PricingResult
      } catch (e) {
        return reply.code(502).send({
          found: false,
          error: e instanceof Error ? e.message : '查询价格失败',
        })
      }
    }
  )
}

export default pricingRoutes
