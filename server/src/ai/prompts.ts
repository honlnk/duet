/**
 * Prompt 模板
 */

import type { AgentColor, AgentRef } from '../types/index.js'

/** buildAgentSystem 的参数 */
interface AgentSystemParams {
  name: string
  persona?: string
  /** 本会话中除自己以外的所有其他智能体名 */
  otherNames: string[]
  topic: string
}

/**
 * 构建某个 AI 的 system prompt（persona + 对话规则）
 * 规则强调「按顺序轮流发言、避免复读、主动推进话题」，防多 AI 漂移。
 * 支持多人对话：列出所有其他参与者。
 */
export function buildAgentSystem({ name, persona, otherNames, topic }: AgentSystemParams): string {
  const othersText =
    otherNames.length === 0
      ? '（暂无其他参与者）'
      : otherNames.length === 1
        ? otherNames[0]
        : otherNames.slice(0, -1).join('、') + ' 和 ' + otherNames[otherNames.length - 1]
  return [
    `你是「${name}」。${persona || ''}`,
    '',
    '## 对话设定',
    `- 你正在参与一场关于以下话题的多方对话：`,
    `  话题：${topic}`,
    `- 你的对话对象（其他参与者）：${othersText}`,
    `- 【重要】大家按固定顺序轮流发言，请只在你该发言的轮次发言，不要抢话，也不要替别人发言。`,
    `- 每次发言控制在 50-200 字以内，自然口语化，避免长篇大论或列表罗列。`,
    `- 【重要】不要重复别人刚刚说过的原话；如果发现对话陷入循环或离题，主动换个角度或推进到下一个子话题。`,
    `- 保持你的身份立场一致，但可以适度回应、质疑或补充其他参与者的观点，让对话自然推进。`,
    `- 直接输出你的发言内容，不要加「${name}:」前缀，不要输出你的思考过程。`,
  ].join('\n')
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
