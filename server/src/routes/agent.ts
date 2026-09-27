/**
 * 导演 Agent 的 SSE 聊天通道。
 *
 * POST /api/agent/chat  body: { sessionId, text, providerId, model, thinking? }
 * → SSE 事件流：delta / tool_call / tool_result / assistant / done / error
 *
 * 选 SSE 不选 WS：一问一答、请求作用域、客户端断开即 abort，无连接态管理。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { getProvider } from '../store/providerStore.js'
import { getAgentSession } from '../agent/messages.js'
import { runAgentQuery, type AgentLoopEvent } from '../agent/query.js'
import { buildDirectorAgentSystemPrompt } from '../agent/prompt.js'
import type { ConnectionConfig } from '../types/index.js'

interface AgentChatBody {
  sessionId: string
  text: string
  providerId: string
  model: string
  thinking?: string
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/agent/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['sessionId', 'text', 'providerId', 'model'],
          properties: {
            sessionId: { type: 'string', minLength: 1 },
            text: { type: 'string', minLength: 1 },
            providerId: { type: 'string', minLength: 1 },
            model: { type: 'string', minLength: 1 },
            thinking: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req: FastifyRequest<{ Body: AgentChatBody }>, reply) => {
      const { sessionId, text, providerId, model, thinking } = req.body

      const prov = getProvider(providerId)
      if (!prov) {
        return reply.code(404).send({ error: 'Provider 不存在' })
      }

      // 会话消息（首条自动带系统提示词）
      const messages = getAgentSession(sessionId)
      if (messages.length === 0) {
        messages.push({ role: 'system', content: buildDirectorAgentSystemPrompt() })
      }
      messages.push({ role: 'user', content: text })

      const conn: ConnectionConfig = {
        baseUrl: prov.baseUrl,
        apiKey: prov.apiKey,
        model,
        protocol: prov.protocol,
        thinkingConfig: prov.thinkingConfig,
      }

      // 接管响应为 SSE 流
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const send = (event: string, data: unknown): void => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      // 客户端断开（刷新/关闭弹框/点停止）→ abort 循环。
      // hijack 后客户端断连的规范信号是响应流的 close（req 流在 body 读完后就会 close，不能用）
      const abort = new AbortController()
      reply.raw.on('close', () => abort.abort())

      const onEvent = (e: AgentLoopEvent): void => {
        if (e.type === 'delta') send('delta', { text: e.text })
        else if (e.type === 'tool_call') send('tool_call', { name: e.name, args: e.args, summary: e.summary })
        else if (e.type === 'tool_result') send('tool_result', { name: e.name, ok: e.ok, summary: e.summary, mutated: e.mutated })
        else if (e.type === 'assistant') send('assistant', { content: e.content })
        else if (e.type === 'done') send('done', { reason: e.reason })
      }

      try {
        await runAgentQuery({ messages, conn, thinking: thinking || undefined, signal: abort.signal, onEvent })
      } catch (e) {
        // LLM 调用失败：v1 不自动重试，surfaced 给用户重发
        send('error', { message: errorMessage(e) })
        send('done', { reason: 'error' })
      } finally {
        reply.raw.end()
      }
    },
  )
}

export default agentRoutes
