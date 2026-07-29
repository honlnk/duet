import config from '../config.js'
import type { ApiMessage, ChatCompletionResult, DeepSeekUsage } from '../types/index.js'

/** DeepSeek 流式响应中的 delta */
interface StreamDelta {
  content?: string | null
  reasoning_content?: string | null
}

/** DeepSeek 流式响应 chunk */
interface StreamChunk {
  choices?: Array<{ delta?: StreamDelta }>
  usage?: DeepSeekUsage
}

/** DeepSeek 非流式响应 */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
      reasoning_content?: string
    }
  }>
  usage?: DeepSeekUsage
}

/** chatCompletion 参数 */
interface ChatCompletionOpts {
  messages: ApiMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  /** content 流式回调 */
  onContent?: (chunk: string) => void
  /** reasoning 流式回调（仅日志，不进对方上下文） */
  onReasoning?: (chunk: string) => void
  /** 外部中止信号 */
  signal?: AbortSignal
}

/**
 * DeepSeek 流式聊天客户端
 *
 * 契约：
 * 1. 调用结果只返回 message.content，绝不返回 reasoning_content（思维链）。
 *    reasoning_content 仅通过 onReasoning 回调透出，供后端调试日志。
 * 2. 流式响应中 content 与 reasoning_content 分阶段到达，每个 chunk 二者其一为 null。
 * 3. 必须传入 AbortSignal 以支持「用户点停止立即中断」。
 * 4. 使用 30s 超时（AbortSignal.timeout）兜底，防止卡死。
 */
export async function chatCompletion({
  messages,
  model,
  temperature = 0.7,
  maxTokens = 1024,
  onContent,
  onReasoning,
  signal,
}: ChatCompletionOpts): Promise<ChatCompletionResult> {
  const url = `${config.deepseekBaseUrl}/chat/completions`
  const body = {
    model: model || config.deepseekModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  }

  // 合并外部 signal 与超时 signal
  const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs)
  const signals: AbortSignal[] = [timeoutSignal]
  if (signal) signals.push(signal)
  const combined = AbortSignal.any(signals)

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify(body),
    signal: combined,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new DeepSeekError(`DeepSeek API ${resp.status}: ${text}`, resp.status)
  }
  if (!resp.body) throw new DeepSeekError('响应无 body', resp.status)

  let content = ''
  let reasoning = ''
  let usage: DeepSeekUsage | null = null

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 以 \n\n 分隔事件
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const dataLine = rawEvent
        .split('\n')
        .find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      const data = dataLine.slice(5).trim()
      if (data === '[DONE]') {
        return { content, reasoning, usage: usage || {} }
      }
      let json: StreamChunk
      try {
        json = JSON.parse(data) as StreamChunk
      } catch {
        continue
      }
      if (json.usage) usage = json.usage
      const delta = json.choices?.[0]?.delta
      if (!delta) continue
      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content
        onReasoning?.(delta.reasoning_content)
      }
      if (delta.content) {
        content += delta.content
        onContent?.(delta.content)
      }
    }
  }

  return { content, reasoning, usage: usage || {} }
}

/** chatComplete 参数 */
interface ChatCompleteOpts {
  model?: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/**
 * 非流式调用（用于摘要等内部任务）。仍只返回 content。
 */
export async function chatComplete(
  messages: ApiMessage[],
  opts: ChatCompleteOpts = {}
): Promise<ChatCompletionResult> {
  const url = `${config.deepseekBaseUrl}/chat/completions`
  const body = {
    model: opts.model || config.deepseekModel,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 800,
    stream: false,
  }
  const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs)
  const signals: AbortSignal[] = [timeoutSignal]
  if (opts.signal) signals.push(opts.signal)
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any(signals),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new DeepSeekError(`DeepSeek API ${resp.status}: ${text}`, resp.status)
  }
  const json = (await resp.json()) as ChatCompletionResponse
  return {
    content: json.choices?.[0]?.message?.content || '',
    reasoning: json.choices?.[0]?.message?.reasoning_content || '',
    usage: json.usage || {},
  }
}

export class DeepSeekError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'DeepSeekError'
    this.status = status
  }
}
