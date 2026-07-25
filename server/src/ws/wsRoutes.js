import { loadSession } from '../store/sessionStore.js'
import { attachClient, runLoop, stopSession } from './chatHandler.js'

/**
 * 注册 WebSocket 路由：/ws/chat?sessionId=xxx
 *
 * 协议（C→S）：{ type: "start" | "stop" | "ping" }
 * 协议（S→C）：见 DEVELOPMENT_PLAN.md §5.4
 */
export default async function wsRoutes(fastify) {
  fastify.get('/ws/chat', { websocket: true }, (socket, req) => {
    const sessionId = req.query.sessionId
    if (!sessionId) {
      socket.send(JSON.stringify({ type: 'error', message: '缺少 sessionId' }))
      socket.close()
      return
    }

    // 安全封装 send
    const send = (msg) => {
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

    socket.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
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
          runLoop(s).catch((e) => {
            send({ type: 'error', message: '运行异常: ' + e.message })
          })
          return
        }
        if (msg.type === 'stop') {
          stopSession(sessionId)
          return
        }
        send({ type: 'error', message: '未知消息类型: ' + msg.type })
      } catch (e) {
        send({ type: 'error', message: e.message })
      }
    })
  })
}
