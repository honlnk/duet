import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AgentColor, SessionConfig } from '../types/index.js'
import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  MIN_AGENTS,
  MAX_AGENTS,
} from '../store/sessionStore.js'
import { isPresetColor } from '../types/index.js'

/** POST /api/sessions 请求体（与 Fastify JSON Schema 对齐） */
interface CreateSessionBody {
  topic: string
  agents: Array<{ name: string; persona?: string; color?: string }>
  config?: Partial<SessionConfig>
}

/** 带 :id 参数的请求 */
type SessionIdRequest = FastifyRequest<{ Params: { id: string } }>

/** 合法 hex 颜色正则（#rgb 或 #rrggbb） */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/

/**
 * 校验颜色值：预设 key 或合法 hex 都通过，否则返回 null。
 */
function validateColor(c: string | undefined): AgentColor | undefined {
  if (!c) return undefined
  if (isPresetColor(c)) return c
  if (HEX_COLOR_RE.test(c)) return c.toLowerCase()
  return undefined
}

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
              minItems: MIN_AGENTS,
              maxItems: MAX_AGENTS,
              items: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 1 },
                  persona: { type: 'string' },
                  color: { type: 'string' },
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
                providerC: { type: 'string' },
                agentProviders: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (req: FastifyRequest<{ Body: CreateSessionBody }>, reply) => {
      const body = req.body
      // 校验颜色：预设 key 或合法 hex 保留，非法 → undefined（由 createSession 补默认色）
      const agentsInput = body.agents.map((a) => ({
        name: a.name,
        persona: a.persona,
        color: validateColor(a.color),
      }))
      const session = createSession({
        topic: body.topic,
        agents: agentsInput,
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
