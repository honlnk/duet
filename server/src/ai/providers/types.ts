/**
 * 协议适配器统一接口与归一化类型。
 *
 * 各协议（OpenAI / Responses / Anthropic / Gemini）的适配器都实现 ProviderAdapter，
 * 把不同协议的请求格式、流式解析、usage 字段统一归一化到 NormalizedUsage。
 * 这样 cost.ts / addStats 等上层逻辑无需感知协议差异。
 */
import type { ApiMessage, ConnectionConfig } from '../../types/index.js'

/**
 * 归一化后的 usage（对齐 DeepSeek/OpenAI 字段名）。
 * 各协议适配器把自身 usage 字段映射到此结构：
 * - OpenAI: 透传 prompt_tokens / completion_tokens / prompt_cache_*
 * - Responses: input_tokens / output_tokens / input_tokens_details.cached_tokens
 * - Anthropic: input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens
 * - Gemini: promptTokenCount / candidatesTokenCount / cachedContentTokenCount
 */
export interface NormalizedUsage {
  prompt_tokens: number
  completion_tokens: number
  prompt_cache_hit_tokens: number
  prompt_cache_miss_tokens: number
  prompt_cache_write_tokens: number
}

/** 适配器返回的调用结果 */
export interface ChatResult {
  content: string
  /** 思维链（仅日志用，不进对方上下文） */
  reasoning?: string
  usage: NormalizedUsage
}

/** 调用参数（流式与非流式共用） */
export interface ChatOpts {
  messages: ApiMessage[]
  /** 连接配置（含协议、baseUrl、apiKey、model） */
  conn: ConnectionConfig
  temperature?: number
  maxTokens?: number
  /** content 流式回调 */
  onContent?: (chunk: string) => void
  /** reasoning 流式回调（仅日志，不进对方上下文） */
  onReasoning?: (chunk: string) => void
  /** 外部中止信号 */
  signal?: AbortSignal
}

/** 协议适配器接口 */
export interface ProviderAdapter {
  /** 流式聊天（对话用） */
  chatCompletion(opts: ChatOpts): Promise<ChatResult>
  /** 非流式聊天（摘要等内部任务用） */
  chatComplete(opts: ChatOpts): Promise<ChatResult>
  /** 拉取该 Provider 可用的模型列表 */
  listModels(conn: ConnectionConfig): Promise<string[]>
}
