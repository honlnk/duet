/**
 * 资产库 REST 路由：模板 CRUD + 关系读写 + 一次性迁移导入。
 *
 * 前端的模板管理（设置弹窗三个 tab）与关系画布经由这组接口读写；
 * 导演 Agent 循环不经由 HTTP，直接调用 libraryStore 的同名函数。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type {
  CharacterTemplateInput,
  LibraryImportPayload,
  TopicTemplateInput,
  WorldviewTemplateInput,
} from '../types/index.js'
import {
  deleteCharacterTemplate,
  deleteRelationship,
  deleteTopicTemplate,
  deleteWorldviewTemplate,
  getRelationships,
  importLibrary,
  libraryIsEmpty,
  listCharacterTemplates,
  listTopicTemplates,
  listWorldviewTemplates,
  setRelationships,
  upsertCharacterTemplate,
  upsertTopicTemplate,
  upsertWorldviewTemplate,
} from '../store/libraryStore.js'

/** 角色模板创建/更新 body schema（create 用） */
const characterBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    personality: { type: 'string' },
  },
  additionalProperties: false,
}

const characterUpdateSchema = {
  ...characterBodySchema,
  required: undefined,
}

const topicBodySchema = {
  type: 'object',
  required: ['content'],
  properties: { content: { type: 'string', minLength: 1 } },
  additionalProperties: false,
}

const topicUpdateSchema = {
  ...topicBodySchema,
  required: undefined,
}

const worldviewBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1 },
    scenario: { type: 'string' },
  },
  additionalProperties: false,
}

const worldviewUpdateSchema = {
  ...worldviewBodySchema,
  required: undefined,
}

const idParamsSchema = {
  type: 'object',
  properties: { id: { type: 'string', minLength: 1 } },
  required: ['id'],
}

async function libraryRoutes(fastify: FastifyInstance): Promise<void> {
  /* --------------------------- 角色模板 --------------------------- */

  fastify.get('/api/templates/characters', async () => listCharacterTemplates())

  fastify.post(
    '/api/templates/characters',
    { schema: { body: characterBodySchema } },
    async (req: FastifyRequest<{ Body: Omit<CharacterTemplateInput, 'id'> }>, reply) => {
      try {
        return upsertCharacterTemplate(req.body)
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : '参数非法' })
      }
    },
  )

  fastify.put(
    '/api/templates/characters/:id',
    { schema: { params: idParamsSchema, body: characterUpdateSchema } },
    async (req: FastifyRequest<{ Params: { id: string }; Body: Omit<CharacterTemplateInput, 'id'> }>, reply) => {
      try {
        return upsertCharacterTemplate({ ...req.body, id: req.params.id })
      } catch (e) {
        const message = e instanceof Error ? e.message : '参数非法'
        return reply.code(message.includes('不存在') ? 404 : 400).send({ error: message })
      }
    },
  )

  fastify.delete(
    '/api/templates/characters/:id',
    { schema: { params: idParamsSchema } },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      return deleteCharacterTemplate(req.params.id)
        ? { ok: true }
        : reply.code(404).send({ error: '角色模板不存在' })
    },
  )

  /* --------------------------- 话题模板 --------------------------- */

  fastify.get('/api/templates/topics', async () => listTopicTemplates())

  fastify.post(
    '/api/templates/topics',
    { schema: { body: topicBodySchema } },
    async (req: FastifyRequest<{ Body: Omit<TopicTemplateInput, 'id'> }>, reply) => {
      try {
        return upsertTopicTemplate(req.body)
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : '参数非法' })
      }
    },
  )

  fastify.put(
    '/api/templates/topics/:id',
    { schema: { params: idParamsSchema, body: topicUpdateSchema } },
    async (req: FastifyRequest<{ Params: { id: string }; Body: Omit<TopicTemplateInput, 'id'> }>, reply) => {
      try {
        return upsertTopicTemplate({ ...req.body, id: req.params.id })
      } catch (e) {
        const message = e instanceof Error ? e.message : '参数非法'
        return reply.code(message.includes('不存在') ? 404 : 400).send({ error: message })
      }
    },
  )

  fastify.delete(
    '/api/templates/topics/:id',
    { schema: { params: idParamsSchema } },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      return deleteTopicTemplate(req.params.id)
        ? { ok: true }
        : reply.code(404).send({ error: '话题模板不存在' })
    },
  )

  /* --------------------------- 世界观模板 --------------------------- */

  fastify.get('/api/templates/worldviews', async () => listWorldviewTemplates())

  fastify.post(
    '/api/templates/worldviews',
    { schema: { body: worldviewBodySchema } },
    async (req: FastifyRequest<{ Body: Omit<WorldviewTemplateInput, 'id'> }>, reply) => {
      try {
        return upsertWorldviewTemplate(req.body)
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : '参数非法' })
      }
    },
  )

  fastify.put(
    '/api/templates/worldviews/:id',
    { schema: { params: idParamsSchema, body: worldviewUpdateSchema } },
    async (req: FastifyRequest<{ Params: { id: string }; Body: Omit<WorldviewTemplateInput, 'id'> }>, reply) => {
      try {
        return upsertWorldviewTemplate({ ...req.body, id: req.params.id })
      } catch (e) {
        const message = e instanceof Error ? e.message : '参数非法'
        return reply.code(message.includes('不存在') ? 404 : 400).send({ error: message })
      }
    },
  )

  fastify.delete(
    '/api/templates/worldviews/:id',
    { schema: { params: idParamsSchema } },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      return deleteWorldviewTemplate(req.params.id)
        ? { ok: true }
        : reply.code(404).send({ error: '世界观模板不存在' })
    },
  )

  /* --------------------------- 关系 + 节点坐标 --------------------------- */

  fastify.get('/api/relationships', async () => getRelationships())

  fastify.put(
    '/api/relationships',
    {
      schema: {
        body: {
          type: 'object',
          required: ['relationships'],
          properties: {
            relationships: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            nodePositions: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                },
                required: ['x', 'y'],
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (req: FastifyRequest<{ Body: { relationships: Record<string, string>; nodePositions?: Record<string, { x: number; y: number }> } }>) => {
      setRelationships(req.body.relationships, req.body.nodePositions)
      return getRelationships()
    },
  )

  /* --------------------------- 迁移导入 --------------------------- */

  fastify.get('/api/library/status', async () => ({ empty: libraryIsEmpty() }))

  fastify.post(
    '/api/library/import',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            characterTemplates: { type: 'array' },
            topicTemplates: { type: 'array' },
            worldviewTemplates: { type: 'array' },
            relationships: { type: 'object' },
            nodePositions: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req: FastifyRequest<{ Body: LibraryImportPayload }>) => {
      return importLibrary(req.body)
    },
  )
}

export default libraryRoutes
