import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AgentColor, DirectorInstruction, SessionConfig } from '../types/index.js'
import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  currentRound,
  MIN_AGENTS,
  MAX_AGENTS,
} from '../store/sessionStore.js'
import { genId, isPresetColor } from '../types/index.js'
import {
  syncRelationshipsToRuntime,
  syncDirectorsToRuntime,
  syncConfigToRuntime,
  broadcastToSession,
} from '../ws/chatHandler.js'
import { getPrompts, clearPrompts } from '../store/promptHistory.js'

/** POST /api/sessions 请求体（与 Fastify JSON Schema 对齐） */
interface CreateSessionBody {
  topic: string
  agents: Array<{ name: string; description?: string; personality?: string; color?: string }>
  config?: Partial<SessionConfig>
  relationships?: Record<string, string>
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
                  description: { type: 'string' },
                  personality: { type: 'string' },
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
                scenario: { type: 'string' },
                pacingEnabled: { type: 'boolean' },
                pacingBufferRounds: { type: 'integer', minimum: 1 },
              },
            },
            relationships: {
              type: 'object',
              additionalProperties: { type: 'string' },
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
        description: a.description,
        personality: a.personality,
        color: validateColor(a.color),
      }))
      const session = createSession({
        topic: body.topic,
        agents: agentsInput,
        config: body.config ?? {},
        relationships: body.relationships,
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
    clearPrompts(req.params.id)
    return { ok: true }
  })

  // 更新会话的关系数据（对话进行中也可修改）
  fastify.patch<{ Params: { id: string }; Body: { relationships?: Record<string, string>; nodePositions?: Record<string, { x: number; y: number }> } }>(
    '/api/sessions/:id/relationships',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            relationships: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            nodePositions: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: false,
                required: ['x', 'y'],
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const session = loadSession(req.params.id)
      if (!session) return reply.code(404).send({ error: '会话不存在' })
      if (req.body.relationships !== undefined) {
        session.relationships = req.body.relationships
        // 同步更新所有 AgentMemoryData 的 relationships（持久化形态）
        for (const a of session.agents) {
          if (session.memory[a.id]) {
            session.memory[a.id]!.relationships = session.relationships
          }
        }
        // 同步到正在运行的会话运行时状态（下一轮 prompt 生效）
        syncRelationshipsToRuntime(req.params.id, session.relationships)
      }
      if (req.body.nodePositions !== undefined) {
        session.nodePositions = req.body.nodePositions
      }
      saveSession(session)
      return session
    },
  )

  // 添加导演指令
  fastify.post<{ Params: { id: string }; Body: { content: string; durationRounds?: number } }>(
    '/api/sessions/:id/directors',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1 },
            durationRounds: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = loadSession(req.params.id)
      if (!session) return reply.code(404).send({ error: '会话不存在' })
      const director: DirectorInstruction = {
        id: genId(),
        content: req.body.content.trim(),
        addedAt: Date.now(),
        addedRound: currentRound(session),
        durationRounds: req.body.durationRounds ?? 0,
      }
      session.directors.push(director)
      saveSession(session)
      // 同步到运行中的 runLoop 内存态（下一轮 prompt 生效）
      syncDirectorsToRuntime(req.params.id, session.directors)
      // 广播给所有 WS 客户端（实时刷新前端面板）
      broadcastToSession(req.params.id, { type: 'director_added', director })
      return session
    },
  )

  // 删除导演指令
  fastify.delete<{ Params: { id: string; iid: string } }>(
    '/api/sessions/:id/directors/:iid',
    async (req, reply) => {
      const session = loadSession(req.params.id)
      if (!session) return reply.code(404).send({ error: '会话不存在' })
      const before = session.directors.length
      session.directors = session.directors.filter((d) => d.id !== req.params.iid)
      if (session.directors.length === before) {
        return reply.code(404).send({ error: '导演指令不存在' })
      }
      saveSession(session)
      syncDirectorsToRuntime(req.params.id, session.directors)
      broadcastToSession(req.params.id, { type: 'director_removed', directorId: req.params.iid })
      return session
    },
  )

  // 更新会话配置（pacing 等）
  fastify.patch<{
    Params: { id: string }
    Body: { pacingEnabled?: boolean; pacingBufferRounds?: number }
  }>(
    '/api/sessions/:id/config',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            pacingEnabled: { type: 'boolean' },
            pacingBufferRounds: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = loadSession(req.params.id)
      if (!session) return reply.code(404).send({ error: '会话不存在' })
      if (req.body.pacingEnabled !== undefined) {
        session.config.pacingEnabled = req.body.pacingEnabled
      }
      if (req.body.pacingBufferRounds !== undefined) {
        session.config.pacingBufferRounds = req.body.pacingBufferRounds
      }
      saveSession(session)
      syncConfigToRuntime(req.params.id, {
        pacingEnabled: session.config.pacingEnabled,
        pacingBufferRounds: session.config.pacingBufferRounds,
      })
      return session
    },
  )

  // 查看某个会话最近发给 LLM 的完整 Prompt（按 agentId 过滤；内存态，进程重启后丢失）
  fastify.get<{ Params: { id: string }; Querystring: { agentId?: string; limit?: string } }>(
    '/api/sessions/:id/prompts',
    async (req, reply) => {
      // 会话是否存在（不存在则 404，与详情接口语义一致）
      const s = loadSession(req.params.id)
      if (!s) return reply.code(404).send({ error: '会话不存在' })
      const limitRaw = Number.parseInt(req.query.limit ?? '', 10)
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined
      const snapshots = getPrompts(req.params.id, req.query.agentId as never, limit)
      return { prompts: snapshots }
    },
  )
}

export default sessionRoutes
