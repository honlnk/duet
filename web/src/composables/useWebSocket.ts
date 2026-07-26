/**
 * useWebSocket —— 会话 WebSocket 连接 composable
 *
 * 改进点（相对旧版 api.js connectWS）：
 * - 在 onOpen 回调中发送 start（旧版用 setTimeout(300) 等待 open，存在竞态）。
 * - 自动重连（1.5s），用户主动 close 时不重连。
 * - send 时若 socket 未 OPEN，按需缓冲 start 消息。
 */
import { ref } from 'vue'
import { buildWsUrl } from '@/services/api'
import type { ClientMessage, ServerEvent } from '@/types/api'

export interface WsHandlers {
  onEvent: (msg: ServerEvent) => void
  onClose?: () => void
}

export function useWebSocket() {
  const connected = ref(false)
  let ws: WebSocket | null = null
  let closedByUser = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let url = ''
  let handlers: WsHandlers | null = null
  // start 在连接建立前缓冲（修复竞态）
  let pendingStart = false

  function open(sessionId: string, h: WsHandlers) {
    url = buildWsUrl(sessionId)
    handlers = h
    closedByUser = false
    pendingStart = false
    doOpen()
  }

  function doOpen() {
    if (!url) return
    ws = new WebSocket(url)

    ws.onopen = () => {
      connected.value = true
      // 连接建立后发送 start（修复旧版 setTimeout 竞态）
      if (pendingStart) {
        send({ type: 'start' })
        pendingStart = false
      }
    }

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerEvent
        handlers?.onEvent(msg)
      } catch {
        /* 忽略解析错误 */
      }
    }

    ws.onclose = () => {
      connected.value = false
      handlers?.onClose?.()
      if (!closedByUser) {
        // 意外断开，自动重连
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(doOpen, 1500)
      }
    }

    ws.onerror = () => {
      // 错误后由 onclose 兜底重连
    }
  }

  function send(msg: ClientMessage) {
    if (msg.type === 'start') {
      // 标记需要发送 start；若已 open 立即发，否则缓冲到 onopen
      pendingStart = true
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
      if (msg.type === 'start') pendingStart = false
    }
    // 未 OPEN 时 start 已缓冲；stop/ ping 在未连接时丢弃
  }

  function close() {
    closedByUser = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    connected.value = false
  }

  return { connected, open, send, close }
}
