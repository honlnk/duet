/**
 * OpenAI 兼容协议适配器（/chat/completions）。
 *
 * 适用于 DeepSeek、OpenAI、OpenRouter 等所有 OpenAI 兼容接口。
 * usage 字段（prompt_tokens / completion_tokens / prompt_cache_*）已是归一化目标结构，直接透传。
 *
 * 契约：
 * 1. 只返回 message.content，绝不返回 reasoning_content（思维链）。
 *    reasoning_content 仅通过 onReasoning 回调透出，供后端调试日志。
 * 2. 流式响应中 content 与 reasoning_content 分阶段到达，每个 chunk 二者其一为 null。
 */
import { trimBaseUrl, withTimeout, readSSE, readErrorBody, AiError, EMPTY_USAGE } from './shared.js'
import type { ChatOpts, ChatResult, NormalizedUsage, ProviderAdapter } from './types.js'
import type { DeepSeekUsage } from '../../types/index.js'

/** 流式响应中的 delta */
interface StreamDelta {
  content?: string | null
  reasoning_content?: string | null
}

/** 流式响应 chunk */
interface StreamChunk {
  choices?: Array<{ delta?: StreamDelta }>
  usage?: DeepSeekUsage
}

/** 非流式响应 */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
      reasoning_content?: string
    }
  }>
  usage?: DeepSeekUsage
}

/** 把 DeepSeek/OpenAI 原始 usage 归一化 */
function normalizeUsage(usage: DeepSeekUsage | undefined): NormalizedUsage {
  if (!usage) return { ...EMPTY_USAGE }
  return {
    prompt_tokens: usage.prompt_tokens ?? 0,
    completion_tokens: usage.completion_tokens ?? 0,
    prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens ?? 0,
    prompt_cache_miss_tokens: usage.prompt_cache_miss_tokens ?? 0,
    prompt_cache_write_tokens: usage.prompt_cache_write_tokens ?? 0,
  }
}

/** 流式聊天 */
async function chatCompletion(opts: ChatOpts): Promise<ChatResult> {
  const { messages, conn, temperature = 0.7, maxTokens = 1024, onContent, onReasoning, signal } = opts
  const url = `${trimBaseUrl(conn.baseUrl)}/chat/completions`
  const body = {
    model: conn.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  }

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
    throw new AiError(`OpenAI API ${resp.status}: ${text}`, resp.status)
  }
  if (!resp.body) throw new AiError('响应无 body', resp.status)

  let content = ''
  let reasoning = ''
  let rawUsage: DeepSeekUsage | undefined

  await readSSE(
    resp.body,
    (fields) => {
      const data = fields.data
      if (!data || data === '[DONE]') return
      let json: StreamChunk
      try {
        json = JSON.parse(data) as StreamChunk
      } catch {
        return
      }
      if (json.usage) rawUsage = json.usage
      const delta = json.choices?.[0]?.delta
      if (!delta) return
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content
        onReasoning?.(delta.reasoning_content)
      }
      if (delta.content) {
        content += delta.content
        onContent?.(delta.content)
      }
    },
    signal,
  )

  return { content, reasoning, usage: normalizeUsage(rawUsage) }
}

/** 非流式聊天 */
async function chatComplete(opts: ChatOpts): Promise<ChatResult> {
  const { messages, conn, temperature = 0.3, maxTokens = 800, signal } = opts
  const url = `${trimBaseUrl(conn.baseUrl)}/chat/completions`
  const body = {
    model: conn.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  }

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
    throw new AiError(`OpenAI API ${resp.status}: ${text}`, resp.status)
  }
  const json = (await resp.json()) as ChatCompletionResponse
  return {
    content: json.choices?.[0]?.message?.content || '',
    reasoning: json.choices?.[0]?.message?.reasoning_content || '',
    usage: normalizeUsage(json.usage),
  }
}

/** 拉取模型列表：GET /models → data[].id */
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

export const openaiAdapter: ProviderAdapter = { chatCompletion, chatComplete, listModels }
