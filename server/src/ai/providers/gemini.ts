/**
 * Google Gemini API 适配器（generateContent / streamGenerateContent）。
 *
 * 协议要点：
 * - 端点：/v1beta/models/{model}:streamGenerateContent（流式）/ :generateContent（非流式）
 * - 鉴权：URL query ?key=（也可用 x-goog-api-key 头，这里用 query）
 * - system 消息抽到顶层 systemInstruction
 * - messages 转 contents:[{role, parts:[{text}]}]，assistant→model 映射
 * - temperature / maxTokens 进 generationConfig（maxTokens → maxOutputTokens）
 * - 流式：SSE data 行是 JSON，取 candidates[0].content.parts[0].text、usageMetadata
 * - usage: promptTokenCount / candidatesTokenCount / cachedContentTokenCount（缓存命中）
 *
 * 注意：Gemini 流式端点用 alt=sse 返回标准 SSE；否则返回 JSON 数组流。这里强制 alt=sse。
 */
import { trimBaseUrl, withTimeout, readSSE, readErrorBody, AiError, EMPTY_USAGE } from './shared.js'
import type { ChatOpts, ChatResult, NormalizedUsage, ProviderAdapter } from './types.js'
import type { ApiMessage } from '../../types/index.js'

/** Gemini usage */
interface GeminiUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
  totalTokenCount?: number
}

/** Gemini 流式/非流式响应 */
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    finishReason?: string
  }>
  usageMetadata?: GeminiUsage
}

/** 归一化 usage */
function normalizeUsage(u: GeminiUsage | undefined): NormalizedUsage {
  if (!u) return { ...EMPTY_USAGE }
  const prompt = u.promptTokenCount ?? 0
  const cached = u.cachedContentTokenCount ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: u.candidatesTokenCount ?? 0,
    prompt_cache_hit_tokens: cached,
    prompt_cache_miss_tokens: Math.max(0, prompt - cached),
    prompt_cache_write_tokens: 0, // Gemini 无缓存写入计费概念
  }
}

/** 把通用 messages 转成 Gemini 的 contents + systemInstruction */
function toGeminiInput(messages: ApiMessage[]): {
  systemInstruction?: { parts: Array<{ text: string }> }
  contents: Array<{ role: string; parts: Array<{ text: string }> }>
} {
  const systemParts: string[] = []
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content)
    } else {
      // assistant → model，user → user
      const role = m.role === 'assistant' ? 'model' : 'user'
      contents.push({ role, parts: [{ text: m.content }] })
    }
  }
  const result: ReturnType<typeof toGeminiInput> = { contents }
  if (systemParts.length > 0) {
    result.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] }
  }
  return result
}

/**
 * 合并思考配置进 body。
 * Gemini 的思考参数嵌在 generationConfig.thinkingConfig，需深合并避免覆盖 temperature：
 * 1. Provider 默认（conn.thinkingConfig）：顶层字段浅合并；若含 generationConfig 则并入 body.generationConfig
 * 2. 会话级档位 thinking：注入 generationConfig.thinkingConfig（thinkingLevel + includeThoughts）
 */
function applyThinking(
  body: Record<string, unknown>,
  conn: ChatOpts['conn'],
  thinking?: string,
): void {
  if (conn.thinkingConfig) {
    const { generationConfig: provGc, ...rest } = conn.thinkingConfig as {
      generationConfig?: Record<string, unknown>
    }
    Object.assign(body, rest)
    if (provGc) {
      const gc = (body.generationConfig ?? {}) as Record<string, unknown>
      Object.assign(gc, provGc)
      body.generationConfig = gc
    }
  }
  if (thinking) {
    const gc = (body.generationConfig ?? {}) as Record<string, unknown>
    gc.thinkingConfig = { thinkingLevel: thinking, includeThoughts: true }
    body.generationConfig = gc
  }
}

/** 流式聊天 */
async function chatCompletion(opts: ChatOpts): Promise<ChatResult> {
  const { messages, conn, temperature = 0.7, maxTokens = 1024, onContent, onReasoning, thinking, signal } = opts
  const { systemInstruction, contents } = toGeminiInput(messages)
  const base = trimBaseUrl(conn.baseUrl)
  const url = `${base}/v1beta/models/${conn.model}:streamGenerateContent?alt=sse&key=${conn.apiKey}`
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  }
  if (systemInstruction) body.systemInstruction = systemInstruction
  applyThinking(body, conn, thinking)

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  })

  if (!resp.ok) {
    const text = await readErrorBody(resp)
    throw new AiError(`Gemini API ${resp.status}: ${text}`, resp.status)
  }
  if (!resp.body) throw new AiError('响应无 body', resp.status)

  let content = ''
  let rawUsage: GeminiUsage | undefined

  await readSSE(
    resp.body,
    (fields) => {
      const data = fields.data
      if (!data) return
      let json: GeminiResponse
      try {
        json = JSON.parse(data) as GeminiResponse
      } catch {
        return
      }
      if (json.usageMetadata) rawUsage = json.usageMetadata
      const parts = json.candidates?.[0]?.content?.parts
      if (parts) {
        for (const p of parts) {
          if (!p.text) continue
          if (p.thought) {
            // 思考片段：不进正文，走思维链回调
            onReasoning?.(p.text)
          } else {
            content += p.text
            onContent?.(p.text)
          }
        }
      }
    },
    signal,
  )

  return { content, usage: normalizeUsage(rawUsage) }
}

/** 非流式聊天 */
async function chatComplete(opts: ChatOpts): Promise<ChatResult> {
  const { messages, conn, temperature = 0.3, maxTokens = 800, thinking, signal } = opts
  const { systemInstruction, contents } = toGeminiInput(messages)
  const base = trimBaseUrl(conn.baseUrl)
  const url = `${base}/v1beta/models/${conn.model}:generateContent?key=${conn.apiKey}`
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  }
  if (systemInstruction) body.systemInstruction = systemInstruction
  applyThinking(body, conn, thinking)

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  })
  if (!resp.ok) {
    const text = await readErrorBody(resp)
    throw new AiError(`Gemini API ${resp.status}: ${text}`, resp.status)
  }
  const json = (await resp.json()) as GeminiResponse
  const parts = json.candidates?.[0]?.content?.parts
  let content = ''
  let reasoning = ''
  if (parts) {
    for (const p of parts) {
      if (!p.text) continue
      if (p.thought) reasoning += p.text
      else content += p.text
    }
  }
  return { content, reasoning, usage: normalizeUsage(json.usageMetadata) }
}

/** 拉取模型列表：GET /v1beta/models → models[].name（去 models/ 前缀） */
async function listModels(conn: ChatOpts['conn']): Promise<string[]> {
  const base = trimBaseUrl(conn.baseUrl)
  const url = `${base}/v1beta/models?key=${conn.apiKey}`
  const resp = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    const text = await readErrorBody(resp)
    throw new AiError(`拉取模型列表失败 ${resp.status}: ${text}`, resp.status)
  }
  const json = (await resp.json()) as { models?: Array<{ name?: string }> }
  const ids = Array.isArray(json.models)
    ? json.models
        .map((m) => m.name ?? '')
        .map((name) => name.replace(/^models\//, '')) // 去 models/ 前缀
        .filter((id) => id.length > 0)
    : []
  return [...new Set(ids)].sort()
}

export const geminiAdapter: ProviderAdapter = { chatCompletion, chatComplete, listModels }
