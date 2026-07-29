import { buildAgentSystem, buildSummaryInjection } from '../ai/prompts.js'
import type {
  AgentMemoryData,
  AgentRef,
  ApiMessage,
  MemoryMessage,
} from '../types/index.js'

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
  agent: AgentRef
  other: AgentRef
  topic: string
  messages: MemoryMessage[]
  summary: string
  lastSummarizedRound: number

  constructor(agent: AgentRef, other: AgentRef, topic: string) {
    this.agent = agent
    this.other = other
    this.topic = topic
    this.messages = []
    this.summary = ''
    this.lastSummarizedRound = 0
  }

  /** 追加一条「我自己」的发言（assistant） */
  pushSelf(content: string): void {
    this.messages.push({ role: 'assistant', content })
  }

  /** 追加一条「对方」的发言（user） */
  pushOther(content: string): void {
    this.messages.push({ role: 'user', content })
  }

  /**
   * 组装发给 LLM 的完整 messages。
   *
   * 不在此处裁剪历史——只做拼装。消息序列从对话开始起纯追加，
   * 直到下一次摘要触发时才由 trimToRecent() 物理裁剪一次。
   * 这样在两次摘要之间，prompt 前缀只增不变，最大化命中 DeepSeek 上下文缓存。
   *
   * @param _keepRecent 已废弃，保留签名仅为向后兼容；裁剪改由摘要流程负责。
   */
  buildApiMessages(_keepRecent: number = 8): ApiMessage[] {
    const sys = buildAgentSystem({
      name: this.agent.name,
      persona: this.agent.persona,
      otherName: this.other.name,
      topic: this.topic,
    })
    const out: ApiMessage[] = [{ role: 'system', content: sys }]
    if (this.summary) {
      out.push({ role: 'system', content: buildSummaryInjection(this.summary) })
    }
    out.push(...this.messages)
    return out
  }

  /** 重建：把摘要后的历史压回 messages（保留最近 keepRecent 条 + 重置 summary） */
  applySummary(newSummary: string, lastRound: number): void {
    this.summary = newSummary
    this.lastSummarizedRound = lastRound
    // 保留最近 N 条原始消息，更早的已被摘要吸收
    // 由调用方在压缩时显式 trim，这里只更新 summary 与 watermark
  }

  trimToRecent(keepRecent: number): void {
    if (this.messages.length > keepRecent) {
      this.messages = this.messages.slice(-keepRecent)
    }
  }

  toJSON(): AgentMemoryData {
    return {
      agent: this.agent,
      other: this.other,
      topic: this.topic,
      messages: this.messages,
      summary: this.summary,
      lastSummarizedRound: this.lastSummarizedRound,
    }
  }

  static fromJSON(obj: AgentMemoryData): AgentMemory {
    const m = new AgentMemory(obj.agent, obj.other, obj.topic)
    m.messages = obj.messages || []
    m.summary = obj.summary || ''
    m.lastSummarizedRound = obj.lastSummarizedRound || 0
    return m
  }
}
