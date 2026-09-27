/**
 * 工具调用公共工具：流式分片组装器 + 参数解析。
 *
 * 四个协议适配器共用：
 * - OpenAI 系（chat/completions、responses）：tool_calls 分片按 index 归位拼接
 * - Anthropic：content_block_start(tool_use) + input_json_delta 分片按块序号拼接
 * - Gemini：functionCall 在 parts 中整块到达，直接 pushComplete
 *
 * 设计参考 NovAI 的流式容错：解析失败的调用直接丢弃（模型输出坏了不迁就）。
 */
import type { AgentToolCall } from '../../types/index.js'

/** 组装中的工具调用 */
interface PendingToolCall {
  id: string
  name: string
  /** arguments 分片累积（字符串形态） */
  args: string
  /** 整块到达时的已解析参数（与 args 二选一） */
  parsedInput?: Record<string, unknown>
}

/** 分片累积器 */
export class ToolCallAssembler {
  private pending = new Map<number, PendingToolCall>()

  /** 收到一条分片（index + 可选 id/name + arguments 增量） */
  push(index: number, fragment: { id?: string; name?: string; args?: string }): void {
    let entry = this.pending.get(index)
    if (!entry) {
      entry = { id: '', name: '', args: '' }
      this.pending.set(index, entry)
    }
    if (fragment.id) entry.id = fragment.id
    if (fragment.name) entry.name += fragment.name
    if (fragment.args) entry.args += fragment.args
  }

  /** 收到一个完整的工具调用（Gemini 整块 functionCall / Anthropic 块结束 / 非流式） */
  pushComplete(call: { id?: string; name: string; input?: unknown; args?: string }): void {
    const index = this.pending.size
    const entry: PendingToolCall = {
      id: call.id ?? '',
      name: call.name,
      args: call.args ?? '',
    }
    if (call.input !== undefined && call.args === undefined) {
      const input = call.input
      entry.parsedInput =
        input !== null && typeof input === 'object' && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : undefined
    }
    this.pending.set(index, entry)
  }

  /** 结算：返回全部合法工具调用（丢弃无名 / 参数解析失败的） */
  finalize(prefix = 'call'): AgentToolCall[] {
    const out: AgentToolCall[] = []
    for (const [, entry] of [...this.pending.entries()].sort((a, b) => a[0] - b[0])) {
      if (!entry.name) continue
      const input = entry.parsedInput ?? parseToolInput(entry.args)
      if (input === null) continue
      out.push({ id: entry.id || `${prefix}_${out.length}`, name: entry.name, input })
    }
    this.pending.clear()
    return out
  }
}

/** 解析 arguments 字符串为参数对象；空串视为无参调用（{}）；解析失败返回 null */
export function parseToolInput(args: string): Record<string, unknown> | null {
  const trimmed = args.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
