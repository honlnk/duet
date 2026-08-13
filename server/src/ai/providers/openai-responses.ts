/**
 * OpenAI Responses API 适配器（/responses）。
 *
 * 与 OpenAI Compatible（/chat/completions）的区别：
 * - 端点是 /responses（client 内部拼 /v1/responses，这里 baseUrl 已含 /v1 时直接拼 /responses）
 * - system 消息抽到顶层 instructions（或保留在 input 内亦可，这里用 instructions 更清晰）
 * - body 用 input 而非 messages；max_output_tokens 代替 max_tokens
 * - 流式事件：response.output_text.delta（增量文本）、response.completed（含 usage）
 * - usage: input_tokens / output_tokens / input_tokens_details.cached_tokens（缓存命中）
 *
 * 注意：Responses API 没有 reasoning_content 流式回调概念，
 * reasoning 文本走 response.reasoning.delta 事件，这里透出到 onReasoning 供日志。
 */
import { trimBaseUrl, withTimeout, readSSE, readErrorBody, AiError, EMPTY_USAGE } from './shared.js'
import type { ChatOpts, ChatResult, NormalizedUsage, ProviderAdapter } from './types.js'
import type { ApiMessage } from '../../types/index.js'

/** Responses API usage */
interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
}

/** Responses 流式事件 */
interface ResponsesEvent {
  type: string
  delta?: string
  response?: { usage?: ResponsesUsage }
  usage?: ResponsesUsage
}

/** Responses 非流式响应 */
interface ResponsesResponse {
  output_text?: string
  output?: Array<{
    type: string
    content?: Array<{ type: string; text?: string }>
  }>
  usage?: ResponsesUsage
}

/** 归一化 usage：input_tokens→prompt、output_tokens→completion、cached_tokens→hit */
function normalizeUsage(u: ResponsesUsage | undefined): NormalizedUsage {
  if (!u) return { ...EMPTY_USAGE }
  const input = u.input_tokens ?? 0
  const cached = u.input_tokens_details?.cached_tokens ?? 0
  return {
    prompt_tokens: input,
    completion_tokens: u.output_tokens ?? 0,
    prompt_cache_hit_tokens: cached,
    prompt_cache_miss_tokens: Math.max(0, input - cached),
    prompt_cache_write_tokens: 0, // Responses API 无缓存写入计费
  }
}

/** 把 system 抽到 instructions，其余转 input 数组（role: user/assistant/developer） */
function toResponsesInput(messages: ApiMessage[]): {
  instructions?: string
  input: Array<{ role: string; content: string }>
} {
  const systemParts: string[] = []
  const input: Array<{ role: string; content: string }> = []
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content)
    } else {
      input.push({ role: m.role, content: m.content })
    }
  }
  const result: ReturnType<typeof toResponsesInput> = { input }
  if (systemParts.length > 0) result.instructions = systemParts.join('\n\n')
  return result
}

/**
 * 合并思考配置进 body：
 * 1. 浅合并 Provider 默认（conn.thinkingConfig）
 * 2. 会话级档位 thinking 覆盖（翻译成 reasoning.effort）
 */
function applyThinking(
  body: Record<string, unknown>,
  conn: ChatOpts['conn'],
  thinking?: string,
): void {
  if (conn.thinkingConfig) Object.assign(body, conn.thinkingConfig)
  if (thinking) body.reasoning = { effort: thinking }
}

/** 流式聊天 */
async function chatCompletion(opts: ChatOpts): Promise<ChatResult> {
  const { messages, conn, temperature = 0.7, maxTokens = 1024, onContent, onReasoning, thinking, signal } = opts
  const { instructions, input } = toResponsesInput(messages)
  const url = `${trimBaseUrl(conn.baseUrl)}/responses`
  const body: Record<string, unknown> = {
    model: conn.model,
    input,
    temperature,
    max_output_tokens: maxTokens,
    stream: true,
  }
  if (instructions) body.instructions = instructions
  applyThinking(body, conn, thinking)

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${conn.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  })

  if (!resp.ok) {
    const text = await readErrorBody(resp)
    throw new AiError(`Responses API ${resp.status}: ${text}`, resp.status)
  }
  if (!resp.body) throw new AiError('响应无 body', resp.status)

  let content = ''
  let rawUsage: ResponsesUsage | undefined

  await readSSE(
    resp.body,
    (fields) => {
      const data = fields.data
      if (!data || data === '[DONE]') return
      let json: ResponsesEvent
      try {
        json = JSON.parse(data) as ResponsesEvent
      } catch {
        return
      }
      // 增量文本
      if (json.type === 'response.output_text.delta' && typeof json.delta === 'string') {
        content += json.delta
        onContent?.(json.delta)
      }
      // 思维链增量（不进对话上下文，仅回调透出）
      if (json.type === 'response.reasoning_text.delta' && typeof json.delta === 'string') {
        onReasoning?.(json.delta)
      }
      // usage（response.completed 事件携带完整 usage）
      if (json.response?.usage) rawUsage = json.response.usage
      if (json.usage) rawUsage = json.usage
    },
    signal,
  )

  return { content, usage: normalizeUsage(rawUsage) }
}

/** 非流式聊天 */
async function chatComplete(opts: ChatOpts): Promise<ChatResult> {
  const { messages, conn, temperature = 0.3, maxTokens = 800, thinking, signal } = opts
  const { instructions, input } = toResponsesInput(messages)
  const url = `${trimBaseUrl(conn.baseUrl)}/responses`
  const body: Record<string, unknown> = {
    model: conn.model,
    input,
    temperature,
    max_output_tokens: maxTokens,
    stream: false,
  }
  if (instructions) body.instructions = instructions
  applyThinking(body, conn, thinking)

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${conn.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  })
  if (!resp.ok) {
    const text = await readErrorBody(resp)
    throw new AiError(`Responses API ${resp.status}: ${text}`, resp.status)
  }
  const json = (await resp.json()) as ResponsesResponse
  // 优先用 output_text（SDK 已拼接），否则从 output 数组提取
  let content = json.output_text
  if (!content && Array.isArray(json.output)) {
    content = json.output
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text' && c.text)
      .map((c) => c.text!)
      .join('')
  }
  return { content: content ?? '', usage: normalizeUsage(json.usage) }
}

/** 拉取模型列表：与 Compatible 共用 GET /models */
async function listModels(conn: ChatOpts['conn']): Promise<string[]> {
  const url = `${trimBaseUrl(conn.baseUrl)}/models`
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${conn.apiKey}` },
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

export const openaiResponsesAdapter: ProviderAdapter = {
  chatCompletion,
  chatComplete,
  listModels,
}
