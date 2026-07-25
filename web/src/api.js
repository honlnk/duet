// WebSocket + REST 封装
const apiBase = '' // 同源

export async function createSession(payload) {
  const r = await fetch(`${apiBase}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!r.ok) throw new Error(`创建会话失败: ${r.status} ${await r.text()}`)
  return r.json()
}

export async function listSessions() {
  const r = await fetch(`${apiBase}/api/sessions`)
  return r.json()
}

export async function getSession(id) {
  const r = await fetch(`${apiBase}/api/sessions/${id}`)
  if (!r.ok) return null
  return r.json()
}

export async function getLimits() {
  const r = await fetch(`${apiBase}/api/config/limits`)
  return r.json()
}

export function connectWS(sessionId, handlers) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${location.host}/ws/chat?sessionId=${sessionId}`
  let ws
  let closedByUser = false
  let reconnectTimer = null

  function open() {
    ws = new WebSocket(url)
    ws.onopen = () => {
      handlers.onOpen?.()
    }
    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      handlers.onMessage?.(msg)
    }
    ws.onclose = () => {
      handlers.onClose?.()
      if (!closedByUser) {
        // 自动重连
        reconnectTimer = setTimeout(open, 1500)
      }
    }
    ws.onerror = () => {
      try { ws.close() } catch {}
    }
  }
  open()

  return {
    send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg))
      }
    },
    close() {
      closedByUser = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try { ws.close() } catch {}
    },
  }
}
