/**
 * 协议适配器工厂 + 公共工具。
 *
 * 调用方通过 getAdapter(protocol) 拿到对应适配器，无需关心具体协议。
 * 适配器内部复用本文件提供的 SSE 读取、超时合并、错误类等公共能力。
 */
import type { ApiProtocol } from '../../types/index.js'
import type { ProviderAdapter } from './types.js'
import { openaiAdapter } from './openai.js'
import { openaiResponsesAdapter } from './openai-responses.js'
import { anthropicAdapter } from './anthropic.js'
import { geminiAdapter } from './gemini.js'

export { AiError, DEFAULT_TIMEOUT_MS } from './shared.js'

/** 按协议类型返回对应适配器 */
export function getAdapter(protocol: ApiProtocol): ProviderAdapter {
  switch (protocol) {
    case 'openai-responses':
      return openaiResponsesAdapter
    case 'anthropic':
      return anthropicAdapter
    case 'gemini':
      return geminiAdapter
    case 'openai':
    default:
      return openaiAdapter
  }
}
