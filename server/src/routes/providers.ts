import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApiProtocol, ProviderFormData } from '../types/index.js'
import { getAdapter } from '../ai/providers/index.js'
import type { AiError } from '../ai/providers/shared.js'
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

/** 协议类型枚举（create/update 共用） */
const protocolEnum = ['openai', 'openai-responses', 'anthropic', 'gemini']

/** Provider 表单 schema（创建用，apiKey 必填） */
const providerFormSchema = {
  type: 'object',
  required: ['name', 'baseUrl', 'apiKey', 'model'],
  properties: {
    name: { type: 'string', minLength: 1 },
    baseUrl: { type: 'string', minLength: 1 },
    apiKey: { type: 'string', minLength: 1 },
    model: { type: 'string', minLength: 1 },
    protocol: { type: 'string', enum: protocolEnum },
    pricing: pricingSchema,
  },
}

/**
 * 通过协议适配器拉取上游模型列表。
 * 不直接暴露给前端（避免泄露 apiKey），由后端持有凭证发起请求。
 * 不同协议走不同的端点与鉴权方式（适配器内部处理）。
 *
 * @param protocol API 协议
 * @param baseUrl  API 基址
 * @param apiKey   API 密钥
 * @returns 模型 id 数组（已去重排序）；失败时抛错（含状态码与上游信息）
 */
async function fetchUpstreamModels(
  protocol: ApiProtocol,
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  // model 字段仅调用时占位用，listModels 不依赖它
  return getAdapter(protocol).listModels({ baseUrl, apiKey, model: '', protocol })
}

/** 把适配器错误转成友好提示（401/403 标注 key 问题） */
function modelFetchError(e: unknown): string {
  const msg = e instanceof Error ? e.message : '拉取模型列表失败'
  const status = (e as AiError)?.status
  const hint = status === 401 || status === 403 ? '（API Key 无效或权限不足）' : ''
  return `${msg}${hint}`
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
            protocol: { type: 'string', enum: protocolEnum },
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
        const models = await fetchUpstreamModels(p.protocol, p.baseUrl, p.apiKey)
        return { models }
      } catch (e) {
        return reply.code(502).send({ error: modelFetchError(e) })
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
            protocol: { type: 'string', enum: protocolEnum },
          },
        },
      },
    },
    async (
      req: FastifyRequest<{
        Body: { baseUrl: string; apiKey: string; protocol?: ApiProtocol }
      }>,
      reply
    ) => {
      try {
        const protocol = req.body.protocol ?? 'openai'
        const models = await fetchUpstreamModels(protocol, req.body.baseUrl, req.body.apiKey)
        return { models }
      } catch (e) {
        return reply.code(502).send({ error: modelFetchError(e) })
      }
    }
  )
}

export default providerRoutes
