/**
 * Agent 会话态：内存 Map + 空闲过期清理。
 *
 * 决策记录（DEV_PLAN_AGENT_LOOP 决策 #5）：聊天历史不持久化——
 * 刷新页面换新 sessionId 即全新会话；服务端只保留最近活跃的会话内存态。
 */
import type { ApiMessage } from '../types/index.js'

/** 会话条目 */
interface AgentSession {
  messages: ApiMessage[]
  lastUsed: number
}

/** 空闲过期时间：2 小时 */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000

const sessions = new Map<string, AgentSession>()

/** 惰性清理过期会话（单用户场景，无需定时器） */
function sweep(): void {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > SESSION_TTL_MS) sessions.delete(id)
  }
}

/** 取会话消息数组（不存在则创建）；调用即续期 */
export function getAgentSession(id: string): ApiMessage[] {
  sweep()
  let s = sessions.get(id)
  if (!s) {
    s = { messages: [], lastUsed: Date.now() }
    sessions.set(id, s)
  }
  s.lastUsed = Date.now()
  return s.messages
}

/** 当前活跃会话数（观测/测试用） */
export function agentSessionCount(): number {
  sweep()
  return sessions.size
}

/** 测试辅助：清空全部会话 */
export function _resetAgentSessions(): void {
  sessions.clear()
}
