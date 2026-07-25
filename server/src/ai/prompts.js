/**
 * Prompt 模板
 */

/**
 * 构建某个 AI 的 system prompt（persona + 对话规则）
 * 规则强调「避免复读、主动推进话题」，防双 AI 漂移。
 */
export function buildAgentSystem({ name, persona, otherName, topic }) {
  return [
    `你是「${name}」。${persona || ''}`,
    '',
    '## 对话设定',
    `- 你正在与「${otherName}」就以下话题进行一对一对话：`,
    `  话题：${topic}`,
    `- 每次发言控制在 50-200 字以内，自然口语化，避免长篇大论或列表罗列。`,
    `- 【重要】不要重复对方刚刚说过的原话；如果发现对话陷入循环或离题，主动换个角度或推进到下一个子话题。`,
    `- 保持你的身份立场一致，但可以适度回应、质疑或补充对方的观点，让对话自然推进。`,
    `- 直接输出你的发言内容，不要加「${name}:」前缀，不要输出你的思考过程。`,
  ].join('\n')
}

/**
 * A 首次发言时的开场 user 提示（只进 A 的 messages，作为 user 角色）
 */
export function buildOpeningPrompt({ name, otherName, topic }) {
  return [
    `现在请就话题「${topic}」开始对话。`,
    `你是「${name}」，你的对话对象是「${otherName}」。`,
    `请用一段话（约 100-200 字）发表你的开场观点，直接开始。`,
  ].join('')
}

/**
 * 把对方的发言包装成 user 消息（加前缀，避免被误以为自言自语）
 * @param {string} otherName
 * @param {string} otherContent  仅取 content，不含 reasoning
 */
export function wrapOtherMessage(otherName, otherContent) {
  return `[${otherName}]: ${otherContent}`
}

/**
 * 摘要生成 prompt（第一人称视角，滚动扩展）
 * 见 DEVELOPMENT_PLAN.md §5.3
 */
export function buildSummaryPrompt({
  agentName,
  otherName,
  oldSummary,
  recentMessages,
  words = 200,
}) {
  return [
    `下面是「${agentName}」参与的一段与「${otherName}」的对话。`,
    `请改以「${agentName}」的第一人称视角重写一份摘要，仿佛这份摘要就是「${agentName}」自己的备忘日记，供它后续继续对话时回忆使用。`,
    '',
    '要求：',
    '1. 用「我」指代「' + agentName + '」，用「对方(' + otherName + ')」指代另一位。',
    '2. 重点记录：当前讨论的话题、我的核心立场与论点、对方的核心立场与论点、我们已达成或未达成的共识、尚未解决的问题。',
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
export function buildSummaryInjection(summary) {
  return `[对话进展摘要（你的视角）]\n${summary}`
}
