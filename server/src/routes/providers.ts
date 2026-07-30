import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ProviderFormData } from '../types/index.js'
import {
  listProviderItems,
  addProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
} from '../store/providerStore.js'

/** Provider 表单 schema（创建用，apiKey 必填） */
const providerFormSchema = {
  type: 'object',
  required: ['name', 'baseUrl', 'apiKey', 'model'],
  properties: {
    name: { type: 'string', minLength: 1 },
    baseUrl: { type: 'string', minLength: 1 },
    apiKey: { type: 'string', minLength: 1 },
    model: { type: 'string', minLength: 1 },
    inputPerMTok: { type: 'number', minimum: 0 },
    outputPerMTok: { type: 'number', minimum: 0 },
  },
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
            inputPerMTok: { type: 'number', minimum: 0 },
            outputPerMTok: { type: 'number', minimum: 0 },
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
}

export default providerRoutes
