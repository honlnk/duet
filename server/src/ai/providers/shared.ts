/**
 * 适配器公共工具：错误类、SSE 读取、超时合并、usage 空对象。
 * 各协议适配器复用这些能力，避免重复实现。
 */
import config from '../../config.js'
import type { NormalizedUsage } from './types.js'

/** 默认请求超时（与原 deepseek.ts 保持一致） */
export const DEFAULT_TIMEOUT_MS = config.requestTimeoutMs

/** AI 调用错误（带 HTTP 状态码，便于上层判断） */
export class AiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AiError'
    this.status = status
  }
}

/** 全零的 usage（上游未返回 usage 时用） */
export const EMPTY_USAGE: NormalizedUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  prompt_cache_hit_tokens: 0,
  prompt_cache_miss_tokens: 0,
  prompt_cache_write_tokens: 0,
}

/**
 * 合并外部中止信号与默认超时信号。
 * 任一触发都会中断 fetch。
 */
export function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  if (!signal) return timeoutSignal
  return AbortSignal.any([timeoutSignal, signal])
}

/** 规范化 baseUrl：去除尾部斜杠 */
export function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/**
 * 通用 SSE 读取器：按 `\n\n` 切分事件，返回每个事件的「字段行」数组。
 *
 * SSE 事件形如：
 *   event: xxx\n
 *   data: {...}\n
 *   \n
 *
 * @param body   ReadableStream（fetch response.body）
 * @param onEvent 每个事件回调：传入 { event, data } 字段映射
 * @param signal  中止信号（与 fetch 共用）
 */
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (fields: { event?: string; data?: string }) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  // 中止时释放 reader
  signal?.addEventListener('abort', () => {
    void reader.cancel().catch(() => {})
  })

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 以空行分隔事件
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const fields = parseSSEEvent(rawEvent)
        if (fields) onEvent(fields)
      }
    }
    // 处理尾部残留
    if (buffer.trim()) {
      const fields = parseSSEEvent(buffer)
      if (fields) onEvent(fields)
    }
  } finally {
    reader.releaseLock()
  }
}

/** 解析单个 SSE 事件块为 { event, data } 字段 */
function parseSSEEvent(raw: string): { event?: string; data?: string } | null {
  const lines = raw.split('\n')
  let event: string | undefined
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  // 至少要有 data 或 event 才算有效事件
  if (event === undefined && dataLines.length === 0) return null
  return {
    event,
    data: dataLines.length > 0 ? dataLines.join('\n') : undefined,
  }
}

/**
 * 读取上游错误响应体（容错）。
 * 失败时返回空串，不抛错（让调用方构造错误信息）。
 */
export async function readErrorBody(resp: Response): Promise<string> {
  try {
    return await resp.text()
  } catch {
    return ''
  }
}
