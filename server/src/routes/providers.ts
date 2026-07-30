import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ProviderFormData } from '../types/index.js'
import {
  listProviderItems,
  addProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  getProvider,
} from '../store/providerStore.js'

/** pricing 子对象 schema（create/update 共用） */
const pricingSchema = {
  type: 'object',
  properties: {
    currency: { type: 'string', minLength: 1 },
    inputPerMTok: { type: 'number', minimum: 0 },
    outputPerMTok: { type: 'number', minimum: 0 },
    cacheHitEnabled: { type: 'boolean' },
    cacheHitPerMTok: { type: 'number', minimum: 0 },
    cacheWriteEnabled: { type: 'boolean' },
    cacheWritePerMTok: { type: 'number', minimum: 0 },
  },
}

/** Provider 表单 schema（创建用，apiKey 必填） */
const providerFormSchema = {
  type: 'object',
  required: ['name', 'baseUrl', 'apiKey', 'model'],
  properties: {
    name: { type: 'string', minLength: 1 },
    baseUrl: { type: 'string', minLength: 1 },
    apiKey: { type: 'string', minLength: 1 },
    model: { type: 'string', minLength: 1 },
    pricing: pricingSchema,
  },
}

/**
 * 代理调用上游 OpenAI 兼容的 GET /models 接口，返回模型 id 列表。
 * 不直接暴露给前端（避免泄露 apiKey），由后端持有凭证发起请求。
 *
 * @param baseUrl API 基址
 * @param apiKey  API 密钥
 * @returns 模型 id 数组（已去重排序）；失败时抛错（含状态码与上游信息）
 */
async function fetchUpstreamModels(
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const hint =
      resp.status === 401 || resp.status === 403
        ? '（API Key 无效或权限不足）'
        : ''
    throw new Error(`上游返回 ${resp.status}${hint}${text ? `: ${text.slice(0, 200)}` : ''}`)
  }
  const json = (await resp.json()) as { data?: Array<{ id?: string }> }
  const ids = Array.isArray(json.data)
    ? json.data.map((m) => m.id).filter((id): id is string => typeof id === 'string')
    : []
  // 去重 + 排序，便于前端展示
  return [...new Set(ids)].sort()
}

async function providerRoutes(fastify: FastifyInstance): Promise<void> {
  // 列表（apiKey 打码）
  fastify.get('/api/providers', async () => {
    return listProviderItems()
  })

  // 创建
  fastify.post(
    '/api/providers',
    { schema: { body: providerFormSchema } },
    async (req: FastifyRequest<{ Body: ProviderFormData }>) => {
      addProvider(req.body)
      // 返回打码后的列表项（不回显真实 key）
      return listProviderItems()
    }
  )

  // 更新（所有字段可选；apiKey 为空字符串表示不修改）
  fastify.put(
    '/api/providers/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            baseUrl: { type: 'string' },
            apiKey: { type: 'string' },
            model: { type: 'string' },
            pricing: pricingSchema,
          },
        },
      },
    },
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: Partial<ProviderFormData> }>,
      reply
    ) => {
      const result = updateProvider(req.params.id, req.body)
      if (!result) return reply.code(404).send({ error: 'Provider 不存在' })
      return listProviderItems()
    }
  )

  // 删除
  fastify.delete(
    '/api/providers/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const result = deleteProvider(req.params.id)
      if (!result.ok) {
        return reply.code(400).send({ error: result.reason })
      }
      return listProviderItems()
    }
  )

  // 设为默认
  fastify.put(
    '/api/providers/default/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const ok = setDefaultProvider(req.params.id)
      if (!ok) return reply.code(404).send({ error: 'Provider 不存在' })
      return listProviderItems()
    }
  )

  // 拉取模型列表：用已保存 Provider 的凭证（编辑/选择态）
  fastify.post(
    '/api/providers/:id/models',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const p = getProvider(req.params.id)
      if (!p) return reply.code(404).send({ error: 'Provider 不存在' })
      try {
        const models = await fetchUpstreamModels(p.baseUrl, p.apiKey)
        return { models }
      } catch (e) {
        return reply
          .code(502)
          .send({ error: e instanceof Error ? e.message : '拉取模型列表失败' })
      }
    }
  )

  // 拉取模型列表：用临时凭证（新增态尚未保存时）
  fastify.post(
    '/api/providers/models',
    {
      schema: {
        body: {
          type: 'object',
          required: ['baseUrl', 'apiKey'],
          properties: {
            baseUrl: { type: 'string', minLength: 1 },
            apiKey: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req: FastifyRequest<{ Body: { baseUrl: string; apiKey: string } }>, reply) => {
      try {
        const models = await fetchUpstreamModels(req.body.baseUrl, req.body.apiKey)
        return { models }
      } catch (e) {
        return reply
          .code(502)
          .send({ error: e instanceof Error ? e.message : '拉取模型列表失败' })
      }
    }
  )
}

export default providerRoutes
