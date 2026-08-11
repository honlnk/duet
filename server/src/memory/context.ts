import { buildAgentSystem, buildSummaryInjection, buildDirectorInjection } from '../ai/prompts.js'
import type {
  AgentMemoryData,
  AgentRef,
  ApiMessage,
  DirectorInstruction,
  MemoryMessage,
} from '../types/index.js'

/**
 * 单个 AI 的上下文管理器。
 *
 * 一个 AgentMemory 维护：
 *   - messages: 该 AI 视角的对话历史（自己是 assistant，其他人是 user）
 *   - summary:  当前摘要（第一人称视角）
 *   - others:   本会话中除自己以外的所有其他智能体（2~3 人）
 *   - relationships: 会话级非对称关系图（Key "{fromId}->{toId}"）
 *
 * 「组装发给 LLM 的 messages」时：
 *   [system: 全局设定 + 主角设定 + 在场角色 + 关系 + 规则（含所有对手名）]
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
  /** 会话级非对称关系图（Key "{fromId}->{toId}"） */
  relationships: Record<string, string>

  constructor(agent: AgentRef, others: AgentRef[], topic: string, relationships?: Record<string, string>) {
    this.agent = agent
    this.others = others
    this.topic = topic
    this.messages = []
    this.summary = ''
    this.lastSummarizedRound = 0
    this.relationships = relationships || {}
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
   * 从会话级关系图中提取「当前 agent 视角」的关系描述。
   * 返回格式化的条目列表，如 ["─── 我与小美的关系 ───\n小美是我的同桌……"]。
   */
  private extractMyRelationships(): string[] {
    const out: string[] = []
    for (const other of this.others) {
      const key = `${this.agent.id}->${other.id}`
      const rel = this.relationships[key]
      if (rel && rel.trim()) {
        out.push(`─── 我与${other.name}的关系 ───\n${rel.trim()}`)
      }
    }
    return out
  }

  /**
   * 组装发给 LLM 的完整 messages。
   *
   * 不在此处裁剪历史——只做拼装。消息序列从对话开始起纯追加，
   * 直到下一次摘要触发时才由 trimToRecent() 物理裁剪一次。
   * 这样在两次摘要之间，prompt 前缀只增不变，最大化命中上下文缓存。
   *
   * 注入顺序（从远到近）：
   *   1. [system] buildAgentSystem（全局设定 + 主角设定 + 在场角色 + 关系 + 对话规则）
   *   2. [system] 摘要注入（若有）
   *   3. [system] 导演指令注入（若有，极高优先级，最接近对话）
   *   4. [...messages]
   *
   * 导演指令作为最接近对话的 system 消息，获得最高注意力权重。
   *
   * @param _keepRecent  已废弃，保留签名仅为向后兼容；裁剪改由摘要流程负责。
   * @param scenario     场景设定 / 世界观
   * @param globalPrompt 导演指令 / 全局规则（会话级静态设定）
   * @param directors    导演指令列表（动态注入，含过期逻辑）
   * @param currentRound 当前轮次（用于过滤已过期导演指令）
   */
  buildApiMessages(
    _keepRecent: number = 8,
    scenario?: string,
    globalPrompt?: string,
    directors?: DirectorInstruction[],
    currentRound?: number,
  ): ApiMessage[] {
    const sys = buildAgentSystem({
      name: this.agent.name,
      description: this.agent.description,
      personality: this.agent.personality,
      others: this.others,
      relationships: this.extractMyRelationships(),
      topic: this.topic,
      scenario,
      globalPrompt,
    })
    const out: ApiMessage[] = [{ role: 'system', content: sys }]
    if (this.summary) {
      out.push({ role: 'system', content: buildSummaryInjection(this.summary) })
    }
    // 导演指令注入（极高优先级：作为最接近对话的 system 消息）
    if (directors && directors.length > 0 && currentRound !== undefined) {
      const injection = buildDirectorInjection(directors, currentRound)
      if (injection) {
        out.push({ role: 'system', content: injection })
      }
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
      relationships: this.relationships,
    }
  }

  static fromJSON(obj: AgentMemoryData): AgentMemory {
    const m = new AgentMemory(obj.agent, obj.others || [], obj.topic, obj.relationships)
    m.messages = obj.messages || []
    m.summary = obj.summary || ''
    m.lastSummarizedRound = obj.lastSummarizedRound || 0
    return m
  }
}
