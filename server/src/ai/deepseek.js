import config from '../config.js'

/**
 * DeepSeek 流式聊天客户端
 *
 * 契约：
 * 1. 调用结果只返回 message.content，绝不返回 reasoning_content（思维链）。
 *    reasoning_content 仅通过 onReasoning 回调透出，供后端调试日志。
 * 2. 流式响应中 content 与 reasoning_content 分阶段到达，每个 chunk 二者其一为 null。
 * 3. 必须传入 AbortSignal 以支持「用户点停止立即中断」。
 * 4. 使用 30s 超时（AbortController.timeout）兜底，防止卡死。
 *
 * @param {object} opts
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {string} [opts.model]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {(chunk:string)=>void} [opts.onContent]    content 流式回调
 * @param {(chunk:string)=>void} [opts.onReasoning]  reasoning 流式回调（仅日志）
 * @param {AbortSignal} [opts.signal]                外部中止信号
 * @returns {Promise<{content:string, reasoning:string, usage:object}>}
 */
export async function chatCompletion({
  messages,
  model,
  temperature = 0.7,
  maxTokens = 1024,
  onContent,
  onReasoning,
  signal,
}) {
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
  const signals = [timeoutSignal]
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
  let usage = null

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 以 \n\n 分隔事件
    let idx
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
      let json
      try {
        json = JSON.parse(data)
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

/**
 * 非流式调用（用于摘要等内部任务）。仍只返回 content。
 */
export async function chatComplete(messages, opts = {}) {
  const url = `${config.deepseekBaseUrl}/chat/completions`
  const body = {
    model: opts.model || config.deepseekModel,
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 800,
    stream: false,
  }
  const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs)
  const signals = [timeoutSignal]
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
  const json = await resp.json()
  return {
    content: json.choices?.[0]?.message?.content || '',
    reasoning: json.choices?.[0]?.message?.reasoning_content || '',
    usage: json.usage || {},
  }
}

export class DeepSeekError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'DeepSeekError'
    this.status = status
  }
}
