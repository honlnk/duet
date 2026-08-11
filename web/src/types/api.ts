/**
 * 后端 API 契约类型定义
 *
 * 严格对应 server/src/store/sessionStore.ts 的数据模型，
 * 以及 server/src/ws/chatHandler.ts 的 WebSocket 事件。
 * 详见 docs/DEVELOPMENT_PLAN.md §5.1 数据模型。
 */

/**
 * 智能体 ID。支持 2~10 个智能体：A、B 为必选，C~J 按需追加。
 */
export type AgentId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J'

/** 所有可能的智能体 ID */
export const ALL_AGENT_IDS: readonly AgentId[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
] as const

/**
 * 预设颜色 key（与前端 CSS 设计 token 一一对应）。
 * 自定义颜色用 hex 字符串，见 AgentColorValue。
 */
export type AgentPresetColor = 'blue' | 'pink' | 'green' | 'amber' | 'purple' | 'teal'

/**
 * 智能体颜色值：预设 key 或自定义 hex（如 '#ff5533'）。
 * - 预设色走 Tailwind class（text-agent-blue 等）
 * - 自定义色走 inline style + CSS 变量（运行时注入，非构建期）
 */
export type AgentColorValue = AgentPresetColor | string

/** 向后兼容别名 */
export type AgentColor = AgentColorValue

/** 前端预设调色板（label 供 UI 展示，key 与 CSS token 对应） */
export const AGENT_COLOR_OPTIONS: ReadonlyArray<{ key: AgentPresetColor; label: string }> = [
  { key: 'blue', label: '蓝色' },
  { key: 'pink', label: '粉色' },
  { key: 'green', label: '绿色' },
  { key: 'amber', label: '琥珀' },
  { key: 'purple', label: '紫色' },
  { key: 'teal', label: '青色' },
]

/** 判断颜色值是否为预设 key */
export function isPresetColor(c: string): c is AgentPresetColor {
  return c === 'blue' || c === 'pink' || c === 'green' ||
    c === 'amber' || c === 'purple' || c === 'teal'
}

/**
 * 智能体默认颜色顺序（按 A/B/C... 依次循环分配）。
 * 超出预设数量时从头部循环复用。
 */
export const DEFAULT_AGENT_COLORS: AgentPresetColor[] = [
  'blue', 'pink', 'green', 'amber', 'purple', 'teal',
]

/** 会话允许的智能体数量区间 */
export const MIN_AGENTS = 2
export const MAX_AGENTS = 10

/** 会话状态 */
export type SessionStatus = 'idle' | 'running' | 'stopped' | 'finished' | 'error'

/** 会话结束原因 */
export type FinishedReason =
  | 'stopped'
  | 'max_rounds'
  | 'duration'
  | 'absolute_limit'
  | 'error'
  | 'crashed'
  | 'shutdown'

/**
 * 导演指令（用户以导演身份干预对话走向）。
 * 注入到系统提示词最高优先级位置（作为最接近对话的独立 system 消息）。
 */
export interface DirectorInstruction {
  id: string
  content: string
  /** 创建时间戳 */
  addedAt: number
  /** 添加时的轮次快照（用于计算剩余有效期） */
  addedRound: number
  /** 有效轮数（0 = 永久有效） */
  durationRounds: number
}

/** 智能体定义（完整会话中的形态） */
export interface Agent {
  id: AgentId
  name: string
  /** 综合身份描述（背景/外貌/核心设定） */
  description?: string
  /** 性格关键词摘要 */
  personality?: string
  /** 颜色标识（与前端 CSS token 对应） */
  color?: AgentColor
}

/** 会话配置 */
export interface SessionConfig {
  /** 对话轮数上限（0 = 无限） */
  maxRounds: number
  /** 持续时间上限秒数（0 = 无限） */
  durationSec: number
  /** 模型名（保留向后兼容） */
  model: string
  /** 生成温度 */
  temperature: number
  /** 每 N 轮触发摘要 */
  summaryEveryN: number
  /** 压缩后保留最近消息数 */
  keepRecent: number
  /** 智能体 A 使用的 Provider id（空 = 默认 Provider） */
  providerA?: string
  /** 智能体 B 使用的 Provider id（空 = 默认 Provider） */
  providerB?: string
  /** 智能体 C 使用的 Provider id（空 = 默认 Provider） */
  providerC?: string
  /** D~J 等智能体的 Provider 映射（优先级高于默认） */
  agentProviders?: Record<string, string>
  /** 场景设定 / 世界观（与 topic 职责分离） */
  scenario?: string
  /** 视窗跟随节奏：启用后，用户不在视窗底部时暂停生成（避免提前生成太多） */
  pacingEnabled?: boolean
  /** 缓冲轮数：超出视窗多少轮后暂停生成（默认 2） */
  pacingBufferRounds?: number
}

/** 单条消息的 token 用量 */
export interface TokenUsage {
  prompt: number
  completion: number
}

/** 消息（session.messages 数组元素） */
export interface ChatMessage {
  agentId: AgentId
  role: 'assistant'
  content: string
  ts: number
  tokens: TokenUsage
  /** true 表示被用户停止截断 */
  truncated: boolean
}

/** 累计成本统计 */
export interface SessionStats {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  /** 缓存命中 token 累计 */
  totalCacheHitTokens: number
  /** 缓存未命中 token 累计 */
  totalCacheMissTokens: number
  /** 缓存写入 token 累计 */
  totalCacheWriteTokens: number
  estCost: number
  /** 成本货币代码（用于展示符号） */
  costCurrency: string
  /** 所有 AI 发言内容的累计字符数 */
  totalChars: number
}

/**
 * 完整的会话对象
 * 对应 createSession() 的返回，以及 GET /api/sessions/:id 和 WS sync 事件。
 * - agents：长度 2 或 3（第 0 个恒为 A、第 1 个为 B，第 2 个（可选）为 C）
 * - memory：A/B 必有；C 仅在三智能体会话时存在
 */
export interface Session {
  id: string
  topic: string
  agents: Agent[]
  config: SessionConfig
  status: SessionStatus
  finishedReason: FinishedReason | null
  startedAt: number | null
  stoppedAt: number | null
  messageCount: number
  currentAgentId: AgentId
  messages: ChatMessage[]
  /** 后端内部记忆（前端通常不渲染，但会出现在 payload 中） */
  memory: Record<AgentId, unknown>
  stats: SessionStats
  error: string | null
  createdAt: number
  updatedAt: number
  /** 非对称关系图：Key "{fromId}->{toId}"，值: from 视角对 to 的关系描述 */
  relationships?: Record<string, string>
  /** 关系图节点位置（XY 坐标），用于关系图管理页布局持久化 */
  nodePositions?: Record<string, { x: number; y: number }>
  /** 导演指令列表（用户以导演身份干预对话走向） */
  directors: DirectorInstruction[]
}

/** GET /api/sessions 列表项（注意 agents 是字符串数组，非对象） */
export interface SessionSummary {
  id: string
  topic: string
  status: SessionStatus
  messageCount: number
  updatedAt: number
  createdAt: number
  agents: string[]
}

/** POST /api/sessions 请求体（支持 2~3 个智能体，每个可带颜色） */
export interface CreateSessionPayload {
  topic: string
  agents: Array<{
    name: string
    description?: string
    personality?: string
    color?: AgentColor
  }>
  config: Partial<SessionConfig>
  /** 非对称关系图：Key "{fromId}->{toId}"，值: from 视角对 to 的关系描述 */
  relationships?: Record<string, string>
}

/** GET /api/config/limits 返回 */
export interface ConfigLimits {
  absoluteMaxRounds: number
  absoluteMaxDurationSec: number
  /** 默认 Provider id（供前端默认选中） */
  defaultProviderId: string
}

/* ------------------------------------------------------------------ */
/* Provider（多套模型连接配置）                                         */
/* ------------------------------------------------------------------ */

/**
 * 价格配置（Provider 维度）。
 * - 输入、输出为必填基础项；
 * - 缓存命中默认启用（多数 Provider 有该计价维度）；
 * - 缓存写入默认关闭（仅 Anthropic 等少数模型存在该计价维度）。
 */
export interface ProviderPricing {
  /** 货币代码，如 'CNY' | 'USD' */
  currency: string
  /** 输入（缓存未命中）单价，单位：该货币/百万 token */
  inputPerMTok: number
  /** 输出单价 */
  outputPerMTok: number
  /** 是否启用缓存命中计价维度 */
  cacheHitEnabled: boolean
  /** 缓存命中单价 */
  cacheHitPerMTok: number
  /** 是否启用缓存写入计价维度 */
  cacheWriteEnabled: boolean
  /** 缓存写入单价 */
  cacheWritePerMTok: number
}

/**
 * 支持的 API 协议。
 * - openai: OpenAI 兼容（/chat/completions）
 * - openai-responses: OpenAI Responses API（/responses）
 * - anthropic: Anthropic Messages API（Claude）
 * - gemini: Google Gemini API
 */
export type ApiProtocol = 'openai' | 'openai-responses' | 'anthropic' | 'gemini'

/** Provider 列表项（apiKey 打码，不暴露原文） */
export interface ProviderListItem {
  id: string
  name: string
  baseUrl: string
  model: string
  /** API 协议类型 */
  protocol: ApiProtocol
  /** 价格配置（含货币与缓存单价） */
  pricing: ProviderPricing
  /** 打码后的 key，如 sk-***x4f2 */
  apiKeyMasked: string
}

/** 创建 / 更新 Provider 的入参 */
export interface ProviderFormData {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  /** API 协议类型 */
  protocol?: ApiProtocol
  /** 价格配置；可选以兼容旧入参，后端归一化补全 */
  pricing?: Partial<ProviderPricing>
}

/** POST /api/providers/:id/models 或 POST /api/providers/models 的返回 */
export interface ModelsResponse {
  models: string[]
}

/** GET /api/pricing/:modelId 返回 */
export interface PricingResponse {
  found: boolean
  matchedId?: string
  pricing?: {
    inputPerMTok: number
    outputPerMTok: number
    cacheHitPerMTok: number
    cacheWritePerMTok: number
    hasCacheHit: boolean
    hasCacheWrite: boolean
  }
}

/** GET /api/exchange-rates 返回（各货币对 base 的汇率） */
export interface ExchangeRatesResponse {
  base: string
  rates: Record<string, number>
}

/** GET /api/providers 返回 */
export interface ProviderListResponse {
  providers: ProviderListItem[]
  defaultId: string
}

/* ------------------------------------------------------------------ */
/* WebSocket 事件类型                                                  */
/* ------------------------------------------------------------------ */

/** 客户端 → 服务器 */
export type ClientMessage =
  | { type: 'start'; maxRounds?: number; durationSec?: number }
  | { type: 'stop' }
  | { type: 'ping' }
  | { type: 'reading'; atBottom: boolean; bufferedRounds: number }

/** 服务器 → 客户端：连接时全量同步 */
export interface SyncEvent {
  type: 'sync'
  session: Session
}

/** 服务器 → 客户端：循环已开始 */
export interface StartedEvent {
  type: 'started'
  /** 本轮启动时间戳（暂停后继续时会被重置，前端据此重置计时器） */
  startedAt: number
}

/** 服务器 → 客户端：流式片段 */
export interface ChunkEvent {
  type: 'chunk'
  agentId: AgentId
  content: string
}

/** 服务器 → 客户端：一轮发言结束（附带权威 message 对象） */
export interface MessageDoneEvent {
  type: 'message_done'
  agentId: AgentId
  message: ChatMessage
}

/** 服务器 → 客户端：摘要生命周期 */
export interface SummaryEvent {
  type: 'summary'
  agentId: AgentId
  phase: 'start' | 'done' | 'error'
  /** 仅 phase=done 时存在 */
  summary?: string
  /** 仅 phase=error 时存在 */
  message?: string
}

/**
 * 服务器 → 客户端：累计统计
 * 注意：字段在顶层展开，非嵌套在 stats 下。
 */
export interface StatsEvent {
  type: 'stats'
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalCacheHitTokens: number
  totalCacheMissTokens: number
  totalCacheWriteTokens: number
  estCost: number
  costCurrency: string
  totalChars: number
}

/** 服务器 → 客户端：一轮结束（round = floor(messageCount/2)） */
export interface TurnEndEvent {
  type: 'turn_end'
  round: number
  messageCount: number
}

/** 服务器 → 客户端：错误 */
export interface ErrorEvent {
  type: 'error'
  message: string
}

/** 服务器 → 客户端：用户已请求暂停，等当前发言完成后停止 */
export interface StoppingEvent {
  type: 'stopping'
}

/** 服务器 → 客户端：循环结束 */
export interface FinishedEvent {
  type: 'finished'
  reason: FinishedReason | string
}

/** 服务器 → 客户端：心跳回复 */
export interface PongEvent {
  type: 'pong'
}

/** 服务器 → 客户端：LLM 请求失败，即将指数退避重试 */
export interface RetryEvent {
  type: 'retry'
  /** 当前重试次数（1 基） */
  attempt: number
  /** 最大重试次数 */
  maxAttempts: number
  /** 本次退避等待毫秒数 */
  delayMs: number
  /** 触发重试的错误信息 */
  error: string
}

/** 服务器 → 客户端：导演指令已添加 */
export interface DirectorAddedEvent {
  type: 'director_added'
  director: DirectorInstruction
}

/** 服务器 → 客户端：导演指令已删除 */
export interface DirectorRemovedEvent {
  type: 'director_removed'
  directorId: string
}

/** 服务器 → 客户端：视窗跟随节奏变化（暂停/恢复） */
export interface PacingEvent {
  type: 'pacing'
  /** waiting = 已暂停生成等待阅读；resumed = 恢复生成 */
  phase: 'waiting' | 'resumed'
}

/** 所有服务器事件联合 */
export type ServerEvent =
  | SyncEvent
  | StartedEvent
  | ChunkEvent
  | MessageDoneEvent
  | SummaryEvent
  | StatsEvent
  | TurnEndEvent
  | ErrorEvent
  | StoppingEvent
  | FinishedEvent
  | PongEvent
  | RetryEvent
  | DirectorAddedEvent
  | DirectorRemovedEvent
  | PacingEvent

/* ----------------------------- Prompt 历史 ----------------------------- */

/** 发给 LLM 的单条消息（与后端 ApiMessage 对应） */
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * 一次「即将发给 LLM 的完整 Prompt」快照。
 * 在后端 buildApiMessages 之后、chatCompletion 之前捕获，所见即所发。
 */
export interface PromptSnapshot {
  agentId: AgentId
  agentName: string
  round: number
  timestamp: number
  protocol: string
  providerName: string
  messages: PromptMessage[]
}

/** GET /api/sessions/:id/prompts 响应 */
export interface PromptHistoryResponse {
  prompts: PromptSnapshot[]
}
