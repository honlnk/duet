/**
 * Prompt 历史记录（内存态环形缓冲）。
 *
 * 在每次「拼装好 ApiMessage[] 准备发给 LLM 之前」捕获一条快照，
 * 按 sessionId → agentId 二级索引存放，每个智能体保留最近 {@link MAX_PER_AGENT} 条。
 *
 * 设计要点：
 * - 纯内存、模块级单例（与 chatHandler 的 runtimes Map、pricing/exchange 的 cache 同构），
 *   进程重启即丢失——符合「最近 N 条」的轻量诉求，不落盘。
 * - 不挂在 Session 对象上：Session 是「写盘 JSON 形状」，塞进去会让每次 saveSession
 *   把完整 prompt 历史序列化到磁盘，体积膨胀且无必要。
 * - 捕获的是「即将发出的真实 Prompt」（buildApiMessages 之后、chatCompletion 之前），
 *   而非事后重建——所见即所发。
 */

import type { AgentId, ApiMessage } from '../types/index.js'

/** 每个智能体保留的最近 prompt 条数 */
export const MAX_PER_AGENT = 20

/** 单条 prompt 快照 */
export interface PromptSnapshot {
  /** 发言智能体 id */
  agentId: AgentId
  /** 发言智能体名（冗余，便于前端展示） */
  agentName: string
  /** 该次发言所在的轮次（由 messageCount 派生） */
  round: number
  /** 捕获时间戳（ms） */
  timestamp: number
  /** 发往 LLM 的协议（openai / anthropic / gemini …） */
  protocol: string
  /** Provider 名（便于诊断） */
  providerName: string
  /** 完整的 messages（system + 摘要注入 + 历史），即 buildApiMessages 的返回值 */
  messages: ApiMessage[]
}

/** 二级结构：sessionId → agentId → 快照数组（最新在尾） */
const store = new Map<string, Map<AgentId, PromptSnapshot[]>>()

/**
 * 记录一条 prompt 快照。
 * 在 chatHandler 调用 buildApiMessages 之后、chatCompletion 之前调用。
 */
export function recordPrompt(sessionId: string, entry: PromptSnapshot): void {
  let perSession = store.get(sessionId)
  if (!perSession) {
    perSession = new Map()
    store.set(sessionId, perSession)
  }
  let list = perSession.get(entry.agentId)
  if (!list) {
    list = []
    perSession.set(entry.agentId, list)
  }
  list.push(entry)
  // 环形裁剪：超出上限丢弃最旧的
  if (list.length > MAX_PER_AGENT) {
    list.splice(0, list.length - MAX_PER_AGENT)
  }
}

/**
 * 查询某个会话的 prompt 历史。
 * @param sessionId 会话 id
 * @param agentId   指定智能体；省略则返回全部智能体的快照（合并后按时间倒序）
 * @param limit     最多返回条数（默认 MAX_PER_AGENT）
 * @returns 按时间倒序（最新在前）的快照数组
 */
export function getPrompts(
  sessionId: string,
  agentId?: AgentId,
  limit: number = MAX_PER_AGENT,
): PromptSnapshot[] {
  const perSession = store.get(sessionId)
  if (!perSession) return []
  if (agentId) {
    const list = perSession.get(agentId)
    if (!list) return []
    // 最新在前
    return list.slice(-limit).reverse()
  }
  // 合并所有 agent，按时间倒序
  const all: PromptSnapshot[] = []
  for (const list of perSession.values()) all.push(...list)
  all.sort((a, b) => b.timestamp - a.timestamp)
  return all.slice(0, limit)
}

/** 删除某个会话的全部 prompt 历史（会话删除时调用，避免泄漏） */
export function clearPrompts(sessionId: string): void {
  store.delete(sessionId)
}
