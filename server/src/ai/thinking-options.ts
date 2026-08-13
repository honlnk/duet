/**
 * 思考可选项查询：按协议获取模型支持的思考档位。
 *
 * 现实约束（调研结论）：
 * - anthropic：上游 /v1/models/{model} 返回 capabilities.thinking，可动态判断 → 真·动态
 * - openai / openai-responses：/models 无能力字段，只能按模型名启发式（o 系列 / gpt-5 / gpt-6）
 * - gemini：/v1beta/models 无思考能力字段，只能按模型名启发式（gemini-2.5+/3+）
 *
 * 对前端统一为「一个接口拿可选项」，后端按协议混合实现。
 * 返回的档位 key 与各适配器注入逻辑严格对应（见 providers/*.ts 的 applyThinking）。
 */
import { trimBaseUrl } from './providers/shared.js'
import type { ApiProtocol } from '../types/index.js'

/** 单个思考档位 */
export interface ThinkingOption {
  /** 档位 key，传给适配器注入（各家原生值） */
  key: string
  /** 中文展示名 */
  label: string
}

/** 思考可选项响应（统一结构，前端不感知协议差异） */
export interface ThinkingOptionsResponse {
  /** 当前模型是否支持思考 */
  supported: boolean
  /** 支持的档位列表（supported=false 时为空） */
  options: ThinkingOption[]
  /** Provider thinkingConfig 里已配置的档位（前端回填默认值用） */
  providerDefault?: string
}

/** OpenAI 系列支持的 reasoning_effort 档位（与 openai.ts/openai-responses.ts 注入对应） */
const OPENAI_EFFORTS: ThinkingOption[] = [
  { key: 'none', label: '关闭' },
  { key: 'minimal', label: '极低' },
  { key: 'low', label: '低' },
  { key: 'medium', label: '中' },
  { key: 'high', label: '高' },
]

/** Gemini 支持的 thinkingLevel 档位（与 gemini.ts 注入对应） */
const GEMINI_LEVELS: ThinkingOption[] = [
  { key: 'MINIMAL', label: '极低' },
  { key: 'LOW', label: '低' },
  { key: 'MEDIUM', label: '中' },
  { key: 'HIGH', label: '高' },
]

/** Anthropic 支持的 thinking.type 档位（与 anthropic.ts 注入对应） */
const ANTHROPIC_OPTIONS: ThinkingOption[] = [
  { key: 'adaptive', label: '自适应（推荐）' },
  { key: 'disabled', label: '关闭' },
]

/** OpenAI 启发式：o 系列 / gpt-5 / gpt-6 系列视为支持 reasoning_effort */
function isOpenAIReasoningModel(model: string): boolean {
  return /^(o\d|gpt-[56]|gpt-o)/i.test(model)
}

/** Gemini 启发式：gemini-2.5+/3+/数字系列视为支持 thinkingConfig */
function isGeminiThinkingModel(model: string): boolean {
  return /gemini-(2\.5|3|\d)/i.test(model)
}

/**
 * 从 Provider thinkingConfig 解析当前档位（前端回填默认值用）。
 * 各协议档位在 JSON 里的路径不同，与适配器注入路径对称。
 */
function extractDefault(
  protocol: ApiProtocol,
  tc?: Record<string, unknown>,
): string | undefined {
  if (!tc) return undefined
  switch (protocol) {
    case 'openai':
      return typeof tc.reasoning_effort === 'string' ? tc.reasoning_effort : undefined
    case 'openai-responses': {
      const r = tc.reasoning as { effort?: string } | undefined
      return typeof r?.effort === 'string' ? r.effort : undefined
    }
    case 'anthropic': {
      const t = tc.thinking as { type?: string } | undefined
      return typeof t?.type === 'string' ? t.type : undefined
    }
    case 'gemini': {
      const gc = tc.generationConfig as { thinkingConfig?: { thinkingLevel?: string } } | undefined
      const inner = gc?.thinkingConfig?.thinkingLevel
      if (typeof inner === 'string') return inner
      return typeof tc.thinkingLevel === 'string' ? tc.thinkingLevel : undefined
    }
  }
}

/** Anthropic 动态查询：调 /v1/models/{model} 取 capabilities.thinking.supported */
async function fetchAnthropicThinkingSupported(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<boolean> {
  const url = `${trimBaseUrl(baseUrl)}/v1/models/${encodeURIComponent(model)}`
  try {
    const resp = await fetch(url, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) return false
    const json = (await resp.json()) as {
      capabilities?: { thinking?: { supported?: boolean } }
    }
    return json.capabilities?.thinking?.supported === true
  } catch {
    return false
  }
}

/**
 * 获取思考可选项（统一入口，按协议分发）。
 *
 * @param protocol       协议
 * @param baseUrl        Provider baseUrl
 * @param apiKey         Provider apiKey
 * @param model          模型 id
 * @param thinkingConfig Provider 配置的思考 JSON（解析 providerDefault 用）
 */
export async function fetchThinkingOptions(
  protocol: ApiProtocol,
  baseUrl: string,
  apiKey: string,
  model: string,
  thinkingConfig?: Record<string, unknown>,
): Promise<ThinkingOptionsResponse> {
  const providerDefault = extractDefault(protocol, thinkingConfig)
  switch (protocol) {
    case 'anthropic': {
      const supported = await fetchAnthropicThinkingSupported(baseUrl, apiKey, model)
      return { supported, options: supported ? ANTHROPIC_OPTIONS : [], providerDefault }
    }
    case 'openai':
    case 'openai-responses': {
      const supported = isOpenAIReasoningModel(model)
      return { supported, options: supported ? OPENAI_EFFORTS : [], providerDefault }
    }
    case 'gemini': {
      const supported = isGeminiThinkingModel(model)
      return { supported, options: supported ? GEMINI_LEVELS : [], providerDefault }
    }
  }
}
