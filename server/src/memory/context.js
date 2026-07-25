import { buildAgentSystem, buildSummaryInjection } from '../ai/prompts.js'

/**
 * 单个 AI 的上下文管理器。
 *
 * 一个 AgentMemory 维护：
 *   - messages: 该 AI 视角的对话历史（自己是 assistant，对方是 user）
 *   - summary:  当前摘要（第一人称视角）
 *
 * 「组装发给 LLM 的 messages」时：
 *   [system: persona + 规则]
 *   [system: 摘要注入（若有）]
 *   [...messages]（已按 keepRecent 裁剪）
 */
export class AgentMemory {
  constructor(agent, other, topic) {
    this.agent = agent   // { id, name, persona }
    this.other = other   // { id, name, persona }
    this.topic = topic
    this.messages = []   // [{role, content}]
    this.summary = ''
    this.lastSummarizedRound = 0
  }

  /** 追加一条「我自己」的发言（assistant） */
  pushSelf(content) {
    this.messages.push({ role: 'assistant', content })
  }

  /** 追加一条「对方」的发言（user） */
  pushOther(content) {
    this.messages.push({ role: 'user', content })
  }

  /** 取最近 n 条（保留最新的） */
  recent(n) {
    return this.messages.slice(-n)
  }

  /**
   * 组装发给 LLM 的完整 messages。
   * @param {number} keepRecent 保留最近 N 条原始消息
   * @returns {Array<{role,content}>}
   */
  buildApiMessages(keepRecent = 8) {
    const sys = buildAgentSystem({
      name: this.agent.name,
      persona: this.agent.persona,
      otherName: this.other.name,
      topic: this.topic,
    })
    const out = [{ role: 'system', content: sys }]
    if (this.summary) {
      out.push({ role: 'system', content: buildSummaryInjection(this.summary) })
    }
    out.push(...this.recent(keepRecent))
    return out
  }

  /** 重建：把摘要后的历史压回 messages（保留最近 keepRecent 条 + 重置 summary） */
  applySummary(newSummary, lastRound) {
    this.summary = newSummary
    this.lastSummarizedRound = lastRound
    // 保留最近 N 条原始消息，更早的已被摘要吸收
    // 由调用方在压缩时显式 trim，这里只更新 summary 与 watermark
  }

  trimToRecent(keepRecent) {
    if (this.messages.length > keepRecent) {
      this.messages = this.messages.slice(-keepRecent)
    }
  }

  toJSON() {
    return {
      agent: this.agent,
      other: this.other,
      topic: this.topic,
      messages: this.messages,
      summary: this.summary,
      lastSummarizedRound: this.lastSummarizedRound,
    }
  }

  static fromJSON(obj) {
    const m = new AgentMemory(obj.agent, obj.other, obj.topic)
    m.messages = obj.messages || []
    m.summary = obj.summary || ''
    m.lastSummarizedRound = obj.lastSummarizedRound || 0
    return m
  }
}
