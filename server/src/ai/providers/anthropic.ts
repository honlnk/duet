/**
 * Anthropic Messages API 适配器（/v1/messages）。
 *
 * 适用于 Claude 官方及各种 Claude 中转。
 *
 * 协议要点：
 * - system 消息必须从 messages 抽出，放顶层 `system` 字段
 * - role 只允许 user / assistant（system 不能出现在 messages）
 * - 鉴权用 `x-api-key` + `anthropic-version` 头（非 Bearer）
 * - max_tokens 为必填项
 * - 流式事件：content_block_delta（delta.text）、message_delta（含 usage）、message_stop
 * - usage: input_tokens / output_tokens / cache_read_input_tokens（缓存命中）/ cache_creation_input_tokens（缓存写入）
 */
import { trimBaseUrl, withTimeout, readSSE, readErrorBody, AiError, EMPTY_USAGE } from './shared.js'
import { ToolCallAssembler } from './tool-support.js'
import type { ChatOpts, ChatResult, NormalizedUsage, ProviderAdapter } from './types.js'
import type { ApiMessage } from '../../types/index.js'

/** Anthropic 原始 usage */
interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Anthropic 流式事件 data */
interface AnthropicEvent {
  type: string
  index?: number
  /** content_block_start 携带块定义（tool_use 含 id/name） */
  content_block?: { type?: string; id?: string; name?: string }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    /** tool_use 参数分片 */
    partial_json?: string
    stop_reason?: string | null
  }
  message?: { usage?: AnthropicUsage }
  usage?: AnthropicUsage // message_delta 里 usage 在顶层
}

/** Anthropic 非流式响应 */
interface AnthropicResponse {
  content?: Array<{
    type: string
    text?: string
    thinking?: string
    /** tool_use 块 */
    id?: string
    name?: string
    input?: unknown
  }>
  usage?: AnthropicUsage
}

/** 归一化 usage：input→prompt、output→completion、cache_read→hit、cache_creation→write */
function normalizeUsage(u: AnthropicUsage | undefined): NormalizedUsage {
  if (!u) return { ...EMPTY_USAGE }
  const input = u.input_tokens ?? 0
  const cacheRead = u.cache_read_input_tokens ?? 0
  const cacheCreate = u.cache_creation_input_tokens ?? 0
  // 未命中 = 输入总量 - 缓存命中 - 缓存写入（Anthropic 的 input_tokens 含全部输入）
  const miss = Math.max(0, input - cacheRead - cacheCreate)
  return {
    prompt_tokens: input,
    completion_tokens: u.output_tokens ?? 0,
    prompt_cache_hit_tokens: cacheRead,
    prompt_cache_miss_tokens: miss,
    prompt_cache_write_tokens: cacheCreate,
  }
}

/** 把通用 messages 拆成 { system, messages }：system 抽到顶层，其余转 Anthropic 线格式 */
function splitSystem(messages: ApiMessage[]): { system: string; messages: Array<Record<string, unknown>> } {
  const systemParts: string[] = []
  const rest: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content)
      continue
    }
    // assistant 携带工具调用 → content 为块数组（text + tool_use）
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: Array<Record<string, unknown>> = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input })
      }
      rest.push({ role: 'assistant', content: blocks })
      continue
    }
    // 工具结果 → user 角色的 tool_result 块（协议要求紧跟 assistant tool_use）
    if (m.role === 'tool') {
      rest.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }],
      })
      continue
    }
    rest.push({ role: m.role, content: m.content })
  }
  return { system: systemParts.join('\n\n'), messages: rest }
}

/**
 * 合并思考配置进 body：
 * 1. 浅合并 Provider 默认（conn.thinkingConfig）
 * 2. 会话级档位 thinking 覆盖（adaptive/disabled → thinking.type）
 */
function applyThinking(
  body: Record<string, unknown>,
  conn: ChatOpts['conn'],
  thinking?: string,
): void {
  if (conn.thinkingConfig) Object.assign(body, conn.thinkingConfig)
  if (thinking) body.thinking = { type: thinking }
}

/** 流式聊天 */
async function chatCompletion(opts: ChatOpts): Promise<ChatResult> {
  const { messages, conn, temperature = 0.7, maxTokens = 1024, onContent, onReasoning, thinking, tools, signal } = opts
  const { system, messages: apiMessages } = splitSystem(messages)
  const url = `${trimBaseUrl(conn.baseUrl)}/v1/messages`
  const body: Record<string, unknown> = {
    model: conn.model,
    messages: apiMessages,
    max_tokens: maxTokens,
    temperature,
    stream: true,
  }
  if (system) body.system = system
  if (tools?.length) {
    // 线格式：{name, description, input_schema}（与 OpenAI 的嵌套 function 结构不同）
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))
    body.tool_choice = { type: 'auto' }
  }
  applyThinking(body, conn, thinking)

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': conn.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  })

  if (!resp.ok) {
    const text = await readErrorBody(resp)
    throw new AiError(`Anthropic API ${resp.status}: ${text}`, resp.status)
  }
  if (!resp.body) throw new AiError('响应无 body', resp.status)

  let content = ''
  let rawUsage: AnthropicUsage | undefined
  const assembler = new ToolCallAssembler()

  await readSSE(
    resp.body,
    (fields) => {
      const data = fields.data
      if (!data) return
      let json: AnthropicEvent
      try {
        json = JSON.parse(data) as AnthropicEvent
      } catch {
        return
      }
      // tool_use 块开始：登记 id/name（input 在后续 input_json_delta 分片到达）
      if (json.type === 'content_block_start' && json.index !== undefined) {
        const block = json.content_block
        if (block?.type === 'tool_use') {
          assembler.push(json.index, { id: block.id, name: block.name })
        }
        return
      }
      // 增量按 delta.type 分流：thinking/text/input_json
      if (json.type === 'content_block_delta' && json.delta) {
        if (json.delta.type === 'thinking_delta' && json.delta.thinking) {
          onReasoning?.(json.delta.thinking)
        } else if (json.delta.type === 'input_json_delta' && json.delta.partial_json) {
          if (json.index !== undefined) {
            assembler.push(json.index, { args: json.delta.partial_json })
          }
        } else if (json.delta.text) {
          content += json.delta.text
          onContent?.(json.delta.text)
        }
      }
      // usage（message_start 带初始 input usage，message_delta 带 output usage）
      if (json.message?.usage) rawUsage = { ...rawUsage, ...json.message.usage }
      if (json.usage) rawUsage = { ...rawUsage, ...json.usage }
    },
    signal,
  )

  return { content, usage: normalizeUsage(rawUsage), toolCalls: assembler.finalize('toolu') }
}

/** 非流式聊天 */
async function chatComplete(opts: ChatOpts): Promise<ChatResult> {
  const { messages, conn, temperature = 0.3, maxTokens = 800, thinking, tools, signal } = opts
  const { system, messages: apiMessages } = splitSystem(messages)
  const url = `${trimBaseUrl(conn.baseUrl)}/v1/messages`
  const body: Record<string, unknown> = {
    model: conn.model,
    messages: apiMessages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  }
  if (system) body.system = system
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))
    body.tool_choice = { type: 'auto' }
  }
  applyThinking(body, conn, thinking)

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': conn.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  })
  if (!resp.ok) {
    const text = await readErrorBody(resp)
    throw new AiError(`Anthropic API ${resp.status}: ${text}`, resp.status)
  }
  const json = (await resp.json()) as AnthropicResponse
  // 拼接所有 text 块（content 是数组，可能有多个 text block）
  const content = (json.content || [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('')
  // 思维链块（type === 'thinking'）单独提取，不进正文
  const reasoning = (json.content || [])
    .filter((b) => b.type === 'thinking' && b.thinking)
    .map((b) => b.thinking!)
    .join('')
  // tool_use 块（input 已是对象，整块收集）
  const assembler = new ToolCallAssembler()
  for (const b of json.content || []) {
    if (b.type === 'tool_use' && b.name) {
      assembler.pushComplete({ id: b.id, name: b.name, input: b.input })
    }
  }
  return { content, reasoning, usage: normalizeUsage(json.usage), toolCalls: assembler.finalize('toolu') }
}

/** 拉取模型列表：GET /v1/models → data[].id */
async function listModels(conn: ChatOpts['conn']): Promise<string[]> {
  const url = `${trimBaseUrl(conn.baseUrl)}/v1/models`
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': conn.apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    const text = await readErrorBody(resp)
    throw new AiError(`拉取模型列表失败 ${resp.status}: ${text}`, resp.status)
  }
  const json = (await resp.json()) as { data?: Array<{ id?: string }> }
  const ids = Array.isArray(json.data)
    ? json.data.map((m) => m.id).filter((id): id is string => typeof id === 'string')
    : []
  return [...new Set(ids)].sort()
}

export const anthropicAdapter: ProviderAdapter = { chatCompletion, chatComplete, listModels }
