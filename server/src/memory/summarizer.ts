import { getAdapter } from '../ai/providers/index.js'
import type { ConnectionConfig } from '../types/index.js'
import { buildSummaryPrompt } from '../ai/prompts.js'
import type { MemoryMessage } from '../types/index.js'

/** summarizeConversation 参数 */
interface SummarizeOpts {
  agentName: string
  otherName: string
  messages: MemoryMessage[]
  oldSummary?: string
  words?: number
  /** 该 Agent 使用的 Provider 连接配置（跟 Agent 走） */
  conn: ConnectionConfig
  signal?: AbortSignal
}

/**
 * 摘要生成器。
 *
 * 输入：该 AI 视角的最近 messages（assistant/user 翻转过的）+ 旧摘要。
 * 输出：新摘要文本（第一人称视角）。
 *
 * 注意：调用 LLM 时只取 content，丢弃 reasoning_content（chatComplete 已处理）。
 */
export async function summarizeConversation({
  agentName,
  otherName,
  messages,
  oldSummary,
  words = 200,
  conn,
  signal,
}: SummarizeOpts): Promise<string> {
  // 把 messages 格式化为可读对话
  const recentText = messages
    .map((m) => {
      const who = m.role === 'assistant' ? agentName : otherName
      return `${who}:\n${m.content}`
    })
    .join('\n\n')

  const prompt = buildSummaryPrompt({
    agentName,
    otherName,
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

  return (result.content || '').trim()
}
