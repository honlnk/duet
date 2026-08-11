/**
 * Prompt 模板
 */

import type { AgentColor, AgentRef, DirectorInstruction } from '../types/index.js'

/** buildAgentSystem 的参数 */
interface AgentSystemParams {
  name: string
  /** 综合身份描述（背景/外貌/核心设定） */
  description?: string
  /** 性格关键词摘要 */
  personality?: string
  /** 本会话中除自己以外的所有其他智能体（完整角色信息） */
  others: AgentRef[]
  /** 当前 agent 对所有他人的关系描述（已提取为「我与某人的关系」条目） */
  relationships?: string[]
  topic: string
  /** 场景设定 / 世界观 */
  scenario?: string
  /** 导演指令 / 全局规则 */
  globalPrompt?: string
}

/**
 * 构建某个 AI 的 system prompt（分层注入：全局设定 → 主角设定 → 在场角色 → 关系 → 对话规则）
 *
 * 分层结构固化顺序，前缀只增不变，最大化命中上下文缓存。
 * - 全局设定：话题 + 场景 + 导演指令（话题恒有，场景/导演指令可选）
 * - 主角设定：description + personality
 * - 在场角色：他人精简描述（2 人场景全量 description）
 * - 关系：第一人称非对称关系描述
 * - 对话规则：字数控制、避免复读
 */
export function buildAgentSystem({
  name,
  description,
  personality,
  others,
  relationships,
  topic,
  scenario,
  globalPrompt,
}: AgentSystemParams): string {
  const sections: string[] = []

  // ─── 全局设定（话题恒在最前，确保所有智能体都明确对话主题）───
  sections.push('─── 全局设定 ───')
  sections.push('[话题]')
  sections.push(topic)
  if (scenario) {
    sections.push('[场景设定]')
    sections.push(scenario)
  }
  if (globalPrompt) {
    sections.push('[导演指令]')
    sections.push(globalPrompt)
  }
  sections.push('')

  // ─── 主角设定 ───
  sections.push('─── 主角设定 ───')
  sections.push(`你是「${name}」。`)
  if (description) {
    sections.push(description)
  }
  if (personality) {
    sections.push(`性格：${personality}`)
  }
  sections.push('')

  // ─── 在场角色 ───
  if (others.length > 0) {
    sections.push('─── 在场角色 ───')
    for (const o of others) {
      // description 和 personality 都有时用「，」连接；description 为空时只输出 personality，避免多余逗号
      const desc = o.description?.trim() || ''
      const psy = o.personality?.trim() || ''
      const parts = [desc, psy ? `性格：${psy}` : ''].filter(Boolean)
      sections.push(`${o.name}：${parts.join('，')}`)
    }
    sections.push('')
  }

  // ─── 关系 ───
  if (relationships && relationships.length > 0) {
    for (const rel of relationships) {
      if (rel.trim()) {
        sections.push(rel.trim())
        sections.push('')
      }
    }
  }

  // ─── 对话设定 ───
  const othersText =
    others.length === 0
      ? '（暂无其他参与者）'
      : others.length === 1
        ? others[0]!.name
        : others.slice(0, -1).map((o) => o.name).join('、') + ' 和 ' + others[others.length - 1]!.name
  sections.push('─── 对话设定 ───')
  sections.push(`- 你正在参与一场关于以下话题的多方对话：`)
  sections.push(`  话题：${topic}`)
  sections.push(`- 你的对话对象（其他参与者）：${othersText}`)
  sections.push(`- 每次发言控制在 50-200 字以内，自然口语化，避免长篇大论或列表罗列。`)
  sections.push(`- 【重要】不要重复别人刚刚说过的原话；如果发现对话陷入循环或离题，主动换个角度或推进到下一个子话题。`)
  sections.push(`- 保持你的身份立场一致，但可以适度回应、质疑或补充其他参与者的观点，让对话自然推进。`)
  sections.push(`- 直接输出你的发言内容，不要加「${name}:」前缀，不要输出你的思考过程。`)

  return sections.join('\n')
}

/** buildOpeningPrompt 的参数 */
interface OpeningPromptParams {
  name: string
  otherNames: string[]
  topic: string
}

/**
 * 首位发言者（A）的开场 user 提示（只进 A 的 messages，作为 user 角色）
 */
export function buildOpeningPrompt({ name, otherNames, topic }: OpeningPromptParams): string {
  const othersText = otherNames.join('、')
  return [
    `现在请就话题「${topic}」开始对话。`,
    `你是「${name}」，你的对话对象是：${othersText}。`,
    `请用一段话（约 100-200 字）发表你的开场观点，直接开始。`,
  ].join('')
}

/**
 * 把其他人的发言包装成 user 消息（加发言者名前缀，避免被误以为自言自语）。
 * 多人对话中，一次可能有多个人在你之前发了言，会各自拼成独立条目。
 */
export function wrapOtherMessage(otherName: string, otherContent: string): string {
  return `[${otherName}]: ${otherContent}`
}

/** buildSummaryPrompt 的参数 */
interface SummaryPromptParams {
  agentName: string
  /** 其他参与者的名字（用于在摘要中以「对方」指代） */
  otherNames: string[]
  oldSummary?: string
  recentMessages: string
  words?: number
}

/**
 * 摘要生成 prompt（第一人称视角，滚动扩展）
 * 见 DEVELOPMENT_PLAN.md §5.3
 */
export function buildSummaryPrompt({
  agentName,
  otherNames,
  oldSummary,
  recentMessages,
  words = 200,
}: SummaryPromptParams): string {
  const othersText = otherNames.join('、')
  return [
    `下面是「${agentName}」参与的一段多方对话（其他参与者：${othersText}）。`,
    `请改以「${agentName}」的第一人称视角重写一份摘要，仿佛这份摘要就是「${agentName}」自己的备忘日记，供它后续继续对话时回忆使用。`,
    '',
    '要求：',
    '1. 用「我」指代「' + agentName + '」，用「对方(名字)」指代其他参与者。',
    '2. 重点记录：当前讨论的话题、我的核心立场与论点、各参与者的核心立场与论点、我们已达成或未达成的共识、尚未解决的问题。',
    '3. 如果已有旧摘要，请【保留旧摘要中的关键事实原句，不要改写已有的事实陈述，只追加新事实】。',
    `4. 控制在 ${words} 字以内。只输出摘要正文，不要任何额外说明。`,
    '',
    '[旧摘要]',
    oldSummary || '（无）',
    '',
    '[最新对话]',
    recentMessages,
  ].join('\n')
}

/**
 * 把摘要注入上下文（system 角色）
 */
export function buildSummaryInjection(summary: string): string {
  return `[对话进展摘要（你的视角）]\n${summary}`
}

/**
 * 构建导演指令注入文本。
 *
 * 作为独立 system 消息注入，置于摘要之后、messages 之前。
 * 作为最接近对话历史的 system 消息，天然获得最高注意力权重（极高优先级）。
 *
 * @param directors    会话全部导演指令
 * @param currentRound 当前轮次（用于过滤已过期指令）
 * @returns 注入文本，无活跃指令时返回 null（不注入）
 */
export function buildDirectorInjection(
  directors: DirectorInstruction[],
  currentRound: number,
): string | null {
  const active = directors.filter(
    (d) => d.durationRounds === 0 || currentRound - d.addedRound < d.durationRounds,
  )
  if (active.length === 0) return null
  const lines = active.map((d) => `• ${d.content}`)
  return ['【导演特别指令（最高优先级，必须严格遵循）】', ...lines].join('\n')
}

/* ----------------------- 颜色辅助（与前端共享） ----------------------- */

/**
 * 智能体默认颜色顺序（按 A/B/C... 依次循环分配）。
 * 超出预设数量时从头部循环复用，保证相邻智能体不撞色。
 */
export const DEFAULT_AGENT_COLORS: AgentColor[] = [
  'blue', 'pink', 'green', 'amber', 'purple', 'teal',
]

/**
 * 取智能体颜色，缺省时按其在 agents 数组中的索引回退到默认色。
 */
export function agentColorOf(agent: AgentRef, fallbackIndex: number): AgentColor {
  return agent.color || DEFAULT_AGENT_COLORS[fallbackIndex] || 'blue'
}
