import { getAdapter } from '../ai/providers/index.js'
import type { NormalizedUsage } from '../ai/providers/types.js'
import type { ConnectionConfig } from '../types/index.js'
import { buildSummaryPrompt } from '../ai/prompts.js'
import type { AgentRef, MemoryMessage } from '../types/index.js'

/** summarizeConversation 参数 */
interface SummarizeOpts {
  agentName: string
  /** 其他参与者的引用（用于在对话文本里标注发言者） */
  others: AgentRef[]
  messages: MemoryMessage[]
  oldSummary?: string
  words?: number
  /** 该 Agent 使用的 Provider 连接配置（跟 Agent 走） */
  conn: ConnectionConfig
  signal?: AbortSignal
}

/** 摘要结果（含 usage 供成本统计） */
export interface SummaryResult {
  content: string
  usage: NormalizedUsage
}

/**
 * 摘要生成器。
 *
 * 输入：该 AI 视角的最近 messages（assistant/user 翻转过的）+ 旧摘要。
 * 输出：新摘要文本（第一人称视角）+ 本次调用 usage（供成本统计）。
 *
 * 多智能体下，user 角色的消息已带「[名字]:」前缀；这里按 messages 的 role
 * 区分：assistant 标注为本智能体名，user 标注为「（其他参与者）」。
 *
 * 注意：调用 LLM 时只取 content，丢弃 reasoning_content（chatComplete 已处理）。
 */
export async function summarizeConversation({
  agentName,
  others,
  messages,
  oldSummary,
  words = 200,
  conn,
  signal,
}: SummarizeOpts): Promise<SummaryResult> {
  const otherNames = others.map((o) => o.name)

  // 把 messages 格式化为可读对话
  const recentText = messages
    .map((m) => {
      // assistant 是本智能体；user 是其他人（content 已带 [名字]: 前缀）
      const who = m.role === 'assistant' ? agentName : '其他参与者'
      return `${who}:\n${m.content}`
    })
    .join('\n\n')

  const prompt = buildSummaryPrompt({
    agentName,
    otherNames,
    oldSummary,
    recentMessages: recentText,
    words,
  })

  const result = await getAdapter(conn.protocol).chatComplete({
    messages: [
      {
        role: 'system',
        content: '你是一个对话摘要助手。请严格按照用户指令输出摘要。',
      },
      { role: 'user', content: prompt },
    ],
    conn,
    temperature: 0.3,
    maxTokens: 600,
    signal,
  })

  return { content: (result.content || '').trim(), usage: result.usage }
}
