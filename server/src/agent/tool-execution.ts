/**
 * 单个工具调用的执行层：未知工具兜底 → 参数校验 → 执行 → 结果文本回灌。
 *
 * 任何失败都不抛出循环，而是作为 tool 消息文本回灌给模型（模型自纠），
 * 保证消息序列始终合法（每个 tool_call 都有配对的 tool result）。
 */
import type { AgentToolCall, ApiMessage } from '../types/index.js'
import { AGENT_TOOLS } from './tools.js'
import type { AgentLoopEvent } from './query.js'

/** 执行一个工具调用，返回回灌用的 tool 消息（同时发事件） */
export async function executeAgentTool(
  call: AgentToolCall,
  onEvent?: (e: AgentLoopEvent) => void,
): Promise<ApiMessage> {
  const tool = AGENT_TOOLS[call.name]

  // 未知工具：不崩循环，回灌提示让模型换正确工具
  if (!tool) {
    const text = `未知工具：${call.name}。可用工具：${Object.keys(AGENT_TOOLS).join('、')}。`
    onEvent?.({ type: 'tool_call', name: call.name, args: call.input, summary: `调用未知工具 ${call.name}` })
    onEvent?.({ type: 'tool_result', name: call.name, ok: false, summary: text, mutated: false })
    return { role: 'tool', content: text, toolCallId: call.id, name: call.name }
  }

  let input: Record<string, unknown>
  try {
    input = tool.validate(call.input)
  } catch (e) {
    const text = `参数校验失败：${e instanceof Error ? e.message : String(e)}`
    onEvent?.({ type: 'tool_call', name: call.name, args: call.input, summary: `${tool.summarize(call.input)}（参数校验失败）` })
    onEvent?.({ type: 'tool_result', name: call.name, ok: false, summary: text, mutated: false })
    return { role: 'tool', content: text, toolCallId: call.id, name: call.name }
  }

  onEvent?.({ type: 'tool_call', name: call.name, args: input, summary: tool.summarize(input) })
  try {
    const text = await tool.run(input)
    onEvent?.({ type: 'tool_result', name: call.name, ok: true, summary: text.trim(), mutated: tool.isWrite })
    return { role: 'tool', content: text, toolCallId: call.id, name: call.name }
  } catch (e) {
    const text = `执行失败：${e instanceof Error ? e.message : String(e)}`
    onEvent?.({ type: 'tool_result', name: call.name, ok: false, summary: text, mutated: false })
    return { role: 'tool', content: text, toolCallId: call.id, name: call.name }
  }
}
