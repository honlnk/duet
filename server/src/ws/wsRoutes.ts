import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import { loadSession } from '../store/sessionStore.js'
import { attachClient, runLoop, stopSession } from './chatHandler.js'
import type { ClientToServerMsg } from '../types/index.js'

/** WS 路由请求（带 querystring） */
type WsChatRequest = FastifyRequest<{
  Querystring: { sessionId?: string }
}>

/**
 * 注册 WebSocket 路由：/ws/chat?sessionId=xxx
 *
 * 协议（C→S）：{ type: "start" | "stop" | "ping" }
 * 协议（S→C）：见 DEVELOPMENT_PLAN.md §5.4
 */
async function wsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/ws/chat',
    { websocket: true },
    (socket: WebSocket, req: WsChatRequest) => {
      const sessionId = req.query.sessionId
      if (!sessionId) {
        socket.send(JSON.stringify({ type: 'error', message: '缺少 sessionId' }))
        socket.close()
        return
      }

      // 安全封装 send
      const send = (msg: Parameters<typeof JSON.stringify>[0]) => {
        if (socket.readyState === 1 /* OPEN */) {
          socket.send(JSON.stringify(msg))
        }
      }

      // 注册客户端；连接断开时自动注销
      const detach = attachClient(sessionId, send)
      socket.on('close', detach)

      // 推送当前会话全量同步
      const session = loadSession(sessionId)
      if (session) {
        send({ type: 'sync', session })
      } else {
        send({ type: 'error', message: '会话不存在' })
      }

      socket.on('message', async (raw: Buffer) => {
        let msg: ClientToServerMsg
        try {
          msg = JSON.parse(raw.toString()) as ClientToServerMsg
        } catch {
          send({ type: 'error', message: '消息格式错误' })
          return
        }
        try {
          if (msg.type === 'ping') {
            send({ type: 'pong' })
            return
          }
          if (msg.type === 'start') {
            const s = loadSession(sessionId)
            if (!s) {
              send({ type: 'error', message: '会话不存在' })
              return
            }
            // 异步跑循环，WS 事件通过 broadcast 回流
            // 透传可选的轮数/时长参数（暂停后继续时覆盖原有上限）
            runLoop(s, {
              maxRounds: msg.maxRounds,
              durationSec: msg.durationSec,
            }).catch((e: unknown) => {
              const m = e instanceof Error ? e.message : String(e)
              send({ type: 'error', message: '运行异常: ' + m })
            })
            return
          }
          if (msg.type === 'stop') {
            stopSession(sessionId)
            return
          }
          send({ type: 'error', message: '未知消息类型: ' + (msg as { type: string }).type })
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e)
          send({ type: 'error', message: m })
        }
      })
    }
  )
}

export default wsRoutes
