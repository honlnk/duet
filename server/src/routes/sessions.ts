import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { SessionConfig } from '../types/index.js'
import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
} from '../store/sessionStore.js'

/** POST /api/sessions 请求体（与 Fastify JSON Schema 对齐） */
interface CreateSessionBody {
  topic: string
  agents: [{ name: string; persona?: string }, { name: string; persona?: string }]
  config?: Partial<SessionConfig>
}

/** 带 :id 参数的请求 */
type SessionIdRequest = FastifyRequest<{ Params: { id: string } }>

async function sessionRoutes(fastify: FastifyInstance): Promise<void> {
  // 创建会话
  fastify.post(
    '/api/sessions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['topic', 'agents'],
          properties: {
            topic: { type: 'string', minLength: 1 },
            agents: {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  persona: { type: 'string' },
                },
              },
            },
            config: {
              type: 'object',
              additionalProperties: false,
              properties: {
                maxRounds: { type: 'integer', minimum: 0 },
                durationSec: { type: 'integer', minimum: 0 },
                model: { type: 'string', minLength: 1 },
                temperature: { type: 'number', minimum: 0, maximum: 2 },
                summaryEveryN: { type: 'integer', minimum: 1 },
                keepRecent: { type: 'integer', minimum: 1 },
                providerA: { type: 'string' },
                providerB: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (req: FastifyRequest<{ Body: CreateSessionBody }>, reply) => {
      const body = req.body
      const session = createSession({
        topic: body.topic,
        agents: body.agents,
        config: body.config ?? {},
      })
      saveSession(session)
      return session
    }
  )

  // 列表
  fastify.get('/api/sessions', async () => {
    return { sessions: listSessions() }
  })

  // 详情
  fastify.get('/api/sessions/:id', async (req: SessionIdRequest, reply) => {
    const s = loadSession(req.params.id)
    if (!s) return reply.code(404).send({ error: '会话不存在' })
    return s
  })

  // 删除
  fastify.delete('/api/sessions/:id', async (req: SessionIdRequest, reply) => {
    const ok = deleteSession(req.params.id)
    if (!ok) return reply.code(404).send({ error: '会话不存在' })
    return { ok: true }
  })
}

export default sessionRoutes
