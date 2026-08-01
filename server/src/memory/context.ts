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
 *   - messages: 该 AI 视角的对话历史（自己是 assistant，其他人是 user）
 *   - summary:  当前摘要（第一人称视角）
 *   - others:   本会话中除自己以外的所有其他智能体（2~3 人）
 *
 * 「组装发给 LLM 的 messages」时：
 *   [system: persona + 规则（含所有对手名）]
 *   [system: 摘要注入（若有）]
 *   [...messages]（已按 keepRecent 裁剪）
 *
 * 多智能体下，「对方」的发言一律以 user 角色追加（带发言者名前缀），
 * 自己的发言以 assistant 角色追加。这样每个智能体都拥有独立的、
 * 第一人称视角的历史，与其它智能体物理隔离。
 */
export class AgentMemory {
  agent: AgentRef
  others: AgentRef[]
  topic: string
  messages: MemoryMessage[]
  summary: string
  lastSummarizedRound: number

  constructor(agent: AgentRef, others: AgentRef[], topic: string) {
    this.agent = agent
    this.others = others
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
   * 这样在两次摘要之间，prompt 前缀只增不变，最大化命中上下文缓存。
   *
   * @param _keepRecent 已废弃，保留签名仅为向后兼容；裁剪改由摘要流程负责。
   */
  buildApiMessages(_keepRecent: number = 8): ApiMessage[] {
    const otherNames = this.others.map((o) => o.name)
    const sys = buildAgentSystem({
      name: this.agent.name,
      persona: this.agent.persona,
      otherNames,
      topic: this.topic,
    })
    const out: ApiMessage[] = [{ role: 'system', content: sys }]
    if (this.summary) {
      out.push({ role: 'system', content: buildSummaryInjection(this.summary) })
    }
    out.push(...this.messages)
    return out
  }

  /** 重建：更新摘要与水位线（物理裁剪由 trimToRecent 负责） */
  applySummary(newSummary: string, lastRound: number): void {
    this.summary = newSummary
    this.lastSummarizedRound = lastRound
  }

  trimToRecent(keepRecent: number): void {
    if (this.messages.length > keepRecent) {
      this.messages = this.messages.slice(-keepRecent)
    }
  }

  toJSON(): AgentMemoryData {
    return {
      agent: this.agent,
      others: this.others,
      topic: this.topic,
      messages: this.messages,
      summary: this.summary,
      lastSummarizedRound: this.lastSummarizedRound,
    }
  }

  static fromJSON(obj: AgentMemoryData): AgentMemory {
    const m = new AgentMemory(obj.agent, obj.others || [], obj.topic)
    m.messages = obj.messages || []
    m.summary = obj.summary || ''
    m.lastSummarizedRound = obj.lastSummarizedRound || 0
    return m
  }
}
