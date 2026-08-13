/**
 * REST API 封装层
 *
 * 同源调用（前端由后端 @fastify/static 托管），apiBase 为空串。
 * 对应 server/src/routes/sessions.ts 和 health.ts。
 */
import type {
  AgentId,
  ApiProtocol,
  ConfigLimits,
  CreateSessionPayload,
  ExchangeRatesResponse,
  ModelsResponse,
  PricingResponse,
  PromptHistoryResponse,
  ProviderFormData,
  ProviderListResponse,
  Session,
  SessionSummary,
  ThinkingOptionsResponse,
} from '@/types/api'

const apiBase = ''

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`请求失败: ${res.status} ${body}`)
  }
  return res.json() as Promise<T>
}

/** 创建会话 */
export function createSession(payload: CreateSessionPayload): Promise<Session> {
  return request<Session>('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** 获取单个会话详情 */
export async function getSession(id: string): Promise<Session | null> {
  try {
    return await request<Session>(`/api/sessions/${id}`)
  } catch {
    return null
  }
}

/** 列出所有会话（摘要） */
export async function listSessions(): Promise<SessionSummary[]> {
  const data = await request<{ sessions: SessionSummary[] }>('/api/sessions')
  return data.sessions
}

/** 删除会话 */
export async function deleteSession(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' })
}

/**
 * 更新会话的关系数据（对话进行中也可修改）。
 * PATCH /api/sessions/:id/relationships
 */
export function updateRelationships(
  id: string,
  body: {
    relationships?: Record<string, string>
    nodePositions?: Record<string, { x: number; y: number }>
  },
): Promise<Session> {
  return request<Session>(`/api/sessions/${id}/relationships`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * 添加导演指令（用户以导演身份干预对话走向）。
 * POST /api/sessions/:id/directors
 * @param content 指令内容
 * @param durationRounds 有效轮数（0 = 永久）
 */
export function addDirector(
  id: string,
  content: string,
  durationRounds: number = 0,
): Promise<Session> {
  return request<Session>(`/api/sessions/${id}/directors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, durationRounds }),
  })
}

/**
 * 删除导演指令。
 * DELETE /api/sessions/:id/directors/:iid
 */
export function deleteDirector(id: string, directorId: string): Promise<Session> {
  return request<Session>(`/api/sessions/${id}/directors/${directorId}`, {
    method: 'DELETE',
  })
}

/**
 * 更新会话配置（视窗跟随节奏等）。
 * PATCH /api/sessions/:id/config
 */
export function updateSessionConfig(
  id: string,
  body: {
    pacingEnabled?: boolean
    pacingBufferRounds?: number
  },
): Promise<Session> {
  return request<Session>(`/api/sessions/${id}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * 查询某会话最近发给 LLM 的完整 Prompt 历史。
 * GET /api/sessions/:id/prompts?agentId=A&limit=20
 * 内存态，进程重启后丢失；未指定 agentId 则返回全部智能体的快照。
 */
export async function getRecentPrompts(
  id: string,
  agentId?: AgentId,
  limit?: number,
): Promise<PromptHistoryResponse> {
  const params = new URLSearchParams()
  if (agentId) params.set('agentId', agentId)
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  return request<PromptHistoryResponse>(`/api/sessions/${id}/prompts${qs ? `?${qs}` : ''}`)
}

/** 获取全局熔断限制与成本单价 */
export function getLimits(): Promise<ConfigLimits> {
  return request<ConfigLimits>('/api/config/limits')
}

/* ----------------------------- Provider ----------------------------- */

/** 列出所有 Provider（apiKey 打码） */
export function listProviders(): Promise<ProviderListResponse> {
  return request<ProviderListResponse>('/api/providers')
}

/** 创建 Provider */
export function createProvider(data: ProviderFormData): Promise<ProviderListResponse> {
  return request<ProviderListResponse>('/api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

/** 更新 Provider（apiKey 为空字符串表示不修改） */
export function updateProvider(
  id: string,
  data: Partial<ProviderFormData>
): Promise<ProviderListResponse> {
  return request<ProviderListResponse>(`/api/providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

/** 删除 Provider */
export function deleteProvider(id: string): Promise<ProviderListResponse> {
  return request<ProviderListResponse>(`/api/providers/${id}`, { method: 'DELETE' })
}

/** 设为默认 Provider */
export function setDefaultProvider(id: string): Promise<ProviderListResponse> {
  return request<ProviderListResponse>(`/api/providers/default/${id}`, { method: 'PUT' })
}

/**
 * 拉取模型列表：用已保存 Provider 的凭证（编辑/选择态）。
 * 后端代理调用上游 GET /models，不暴露 apiKey。
 */
export function fetchProviderModels(id: string): Promise<ModelsResponse> {
  return request<ModelsResponse>(`/api/providers/${id}/models`, { method: 'POST' })
}

/**
 * 拉取模型列表：用临时凭证（新增态尚未保存时）。
 * baseUrl / apiKey / protocol 仅在后端内存中使用，不落盘。
 */
export function fetchModelsByCred(
  baseUrl: string,
  apiKey: string,
  protocol: ApiProtocol = 'openai'
): Promise<ModelsResponse> {
  return request<ModelsResponse>('/api/providers/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey, protocol }),
  })
}

/**
 * 拉取思考可选项：用已保存 Provider 的凭证。
 * 返回该模型支持的思考档位 + Provider 配置的默认档位（回填用）。
 */
export function fetchThinkingOptions(id: string): Promise<ThinkingOptionsResponse> {
  return request<ThinkingOptionsResponse>(`/api/providers/${id}/thinking-options`, {
    method: 'POST',
  })
}

/**
 * 拉取思考可选项：用临时凭证（新增态尚未保存时）。
 */
export function fetchThinkingOptionsByCred(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: ApiProtocol = 'openai'
): Promise<ThinkingOptionsResponse> {
  return request<ThinkingOptionsResponse>('/api/providers/thinking-options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, apiKey, model, protocol }),
  })
}

/**
 * 查询模型价格：后端代理 OpenRouter，按 modelId 模糊匹配后返回美元/百万 token 价格。
 * 仅作参考，用户可手动修改。
 */
export function fetchModelPricing(modelId: string): Promise<PricingResponse> {
  return request<PricingResponse>(`/api/pricing/${encodeURIComponent(modelId)}`)
}

/** 获取汇率（各货币对 USD） */
export function fetchExchangeRates(): Promise<ExchangeRatesResponse> {
  return request<ExchangeRatesResponse>('/api/exchange-rates')
}

/** 构造 WebSocket 地址 */
export function buildWsUrl(sessionId: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/chat?sessionId=${encodeURIComponent(sessionId)}`
}
