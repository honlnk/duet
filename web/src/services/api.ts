/**
 * REST API 封装层
 *
 * 同源调用（前端由后端 @fastify/static 托管），apiBase 为空串。
 * 对应 server/src/routes/sessions.ts 和 health.ts。
 */
import type {
  ConfigLimits,
  CreateSessionPayload,
  Session,
  SessionSummary,
} from '@/types/api'

const apiBase = ''

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`请求失败: ${res.status} ${body}`)
  }
  return res.json() as Promise<T>
}

/** 创建会话 */
export function createSession(payload: CreateSessionPayload): Promise<Session> {
  return request<Session>('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** 获取单个会话详情 */
export async function getSession(id: string): Promise<Session | null> {
  try {
    return await request<Session>(`/api/sessions/${id}`)
  } catch {
    return null
  }
}

/** 列出所有会话（摘要） */
export async function listSessions(): Promise<SessionSummary[]> {
  const data = await request<{ sessions: SessionSummary[] }>('/api/sessions')
  return data.sessions
}

/** 删除会话 */
export async function deleteSession(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' })
}

/** 获取全局熔断限制与成本单价 */
export function getLimits(): Promise<ConfigLimits> {
  return request<ConfigLimits>('/api/config/limits')
}

/** 构造 WebSocket 地址 */
export function buildWsUrl(sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/chat?sessionId=${encodeURIComponent(sessionId)}`
}
