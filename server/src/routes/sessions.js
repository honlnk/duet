import {
  createSession,
  loadSession,
  listSessions,
  deleteSession,
} from '../store/sessionStore.js'

export default async function sessionRoutes(fastify) {
  // 创建会话
  fastify.post('/api/sessions', {
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
          config: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const session = createSession({
      topic: req.body.topic,
      agents: req.body.agents,
      config: req.body.config || {},
    })
    // 持久化
    const { saveSession } = await import('../store/sessionStore.js')
    saveSession(session)
    return session
  })

  // 列表
  fastify.get('/api/sessions', async () => {
    return { sessions: listSessions() }
  })

  // 详情
  fastify.get('/api/sessions/:id', async (req, reply) => {
    const s = loadSession(req.params.id)
    if (!s) return reply.code(404).send({ error: '会话不存在' })
    return s
  })

  // 删除
  fastify.delete('/api/sessions/:id', async (req, reply) => {
    const ok = deleteSession(req.params.id)
    if (!ok) return reply.code(404).send({ error: '会话不存在' })
    return { ok: true }
  })
}
