/**
 * Agent 循环主循环（NovAI query.ts 的简化子集）。
 *
 * 每个 step：LLM 流式调用（带工具表）→ assistant 落消息 →
 * 有 toolCalls 就逐个执行回灌、继续下一 step；没有就收尾。
 *
 * 相对 NovAI 裁剪：无上下文压缩、无 steering 插话、无溢出重试、无 LLM 自动重试
 * （失败直接抛给 SSE 层 surfaced，用户可自行重发）。保留：AbortController、轮次安全阀。
 */
import { getAdapter } from '../ai/providers/index.js'
import type { ApiMessage, ConnectionConfig } from '../types/index.js'
import { executeAgentTool } from './tool-execution.js'
import { AGENT_TOOL_SCHEMAS } from './tools.js'

/** 循环向外的全部事件（SSE 层转成事件流） */
export type AgentLoopEvent =
  | { type: 'delta'; text: string }
  | { type: 'assistant'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; summary: string }
  | { type: 'tool_result'; name: string; ok: boolean; summary: string; mutated: boolean }
  | { type: 'done'; reason: 'completed' | 'turn_limit' | 'aborted' }

/** 轮次安全阀：单次用户消息触发的 LLM 调用上限（防工具死循环） */
export const AGENT_MAX_TURNS = 30

/**
 * 跑一轮 Agent 循环。
 *
 * @param opts.messages 会话消息数组（原地追加 assistant/tool 消息；由调用方持有会话态）
 * @param opts.conn     LLM 连接（由 Provider + 模型 + 思考档位构建）
 * @param opts.onEvent  事件回调（delta / tool_call / tool_result / assistant / done）
 */
export async function runAgentQuery(opts: {
  messages: ApiMessage[]
  conn: ConnectionConfig
  thinking?: string
  maxTurns?: number
  signal?: AbortSignal
  onEvent: (e: AgentLoopEvent) => void
}): Promise<void> {
  const { messages, conn, thinking, signal, onEvent } = opts
  const maxTurns = opts.maxTurns ?? AGENT_MAX_TURNS
  const adapter = getAdapter(conn.protocol)

  let turns = 0
  while (true) {
    // 每个 step 开始前检查停止（上一批工具执行完后的边界）
    if (signal?.aborted) {
      onEvent({ type: 'done', reason: 'aborted' })
      return
    }
    if (turns >= maxTurns) {
      onEvent({ type: 'done', reason: 'turn_limit' })
      return
    }
    turns += 1

    const result = await adapter.chatCompletion({
      messages,
      conn,
      thinking,
      tools: AGENT_TOOL_SCHEMAS,
      onContent: (text) => onEvent({ type: 'delta', text }),
      signal,
    })

    messages.push({
      role: 'assistant',
      content: result.content,
      toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
    })

    // 无工具调用 → 本轮任务收尾
    if (result.toolCalls.length === 0) {
      onEvent({ type: 'assistant', content: result.content })
      onEvent({ type: 'done', reason: 'completed' })
      return
    }

    // 顺序执行工具批次，逐个回灌（批次内每个调用都补 tool result，序列恒合法）
    for (const call of result.toolCalls) {
      if (signal?.aborted) {
        messages.push({ role: 'tool', content: '已因用户停止而跳过该工具', toolCallId: call.id, name: call.name })
        continue
      }
      messages.push(await executeAgentTool(call, onEvent))
    }
  }
}
