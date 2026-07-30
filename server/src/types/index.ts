/**
 * 后端类型定义
 *
 * 与前端 web/src/types/api.ts 手工保持对齐。
 * 此处定义后端视角的完整类型，包含前端不渲染的内部结构（如 memory）。
 */

/* ============================== 基础枚举 ============================== */

/** 智能体 ID（固定两个） */
export type AgentId = 'A' | 'B'

/** 消息角色（发给 LLM 的完整消息） */
export type MessageRole = 'system' | 'user' | 'assistant'

/** 会话状态 */
export type SessionStatus = 'idle' | 'running' | 'stopped' | 'finished' | 'error'

/** 会话结束原因（union + string 兜底，因 chatHandler 允许任意字符串） */
export type FinishedReason =
  | 'stopped'
  | 'max_rounds'
  | 'duration'
  | 'absolute_limit'
  | 'error'
  | 'crashed'
  | 'shutdown'
  | (string & {})

/* ============================== 实体类型 ============================== */

/** 智能体引用 */
export interface AgentRef {
  id: AgentId
  name: string
  persona: string
}

/** 记忆内部消息（无 agentId / ts，仅 role + content） */
export interface MemoryMessage {
  role: Exclude<MessageRole, 'system'>
  content: string
}

/** 发给 LLM 的消息 */
export interface ApiMessage {
  role: MessageRole
  content: string
}

/** AgentMemory.toJSON() 的持久化形态 */
export interface AgentMemoryData {
  agent: AgentRef
  other: AgentRef
  topic: string
  messages: MemoryMessage[]
  summary: string
  lastSummarizedRound: number
}

/** 单条消息的 token 用量（camelCase，已从 snake 转换） */
export interface TokenUsage {
  prompt: number
  completion: number
}

/** 持久化在 session.messages 的消息 */
export interface PersistedMessage {
  agentId: AgentId
  role: 'assistant'
  content: string
  ts: number
  tokens: TokenUsage
  truncated: boolean
}

/** 会话配置 */
export interface SessionConfig {
  /** 对话轮数上限（0 = 无限） */
  maxRounds: number
  /** 持续时间上限秒数（0 = 无限） */
  durationSec: number
  /** DeepSeek 模型名（保留向后兼容；新逻辑以 provider 的 model 为准） */
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
}

/** 累计成本统计 */
export interface SessionStats {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  /** 缓存命中 token 累计（命中按低价计费） */
  totalCacheHitTokens: number
  /** 缓存未命中 token 累计（按输入原价计费） */
  totalCacheMissTokens: number
  /** 缓存写入 token 累计（少数模型按额外价计费） */
  totalCacheWriteTokens: number
  estCost: number
  /** 成本货币代码（取默认 Provider 的货币，用于前端展示符号） */
  costCurrency: string
  /** 所有 AI 发言内容的累计字符数 */
  totalChars: number
}

/** 完整会话对象（写盘 JSON 形状） */
export interface Session {
  id: string
  topic: string
  agents: [AgentRef, AgentRef]
  config: SessionConfig
  status: SessionStatus
  finishedReason: FinishedReason | null
  startedAt: number | null
  stoppedAt: number | null
  messageCount: number
  currentAgentId: AgentId
  messages: PersistedMessage[]
  memory: { A: AgentMemoryData; B: AgentMemoryData }
  stats: SessionStats
  error: string | null
  createdAt: number
  updatedAt: number
}

/** listSessions 返回的列表项（agents 是 name 数组） */
export interface SessionListItem {
  id: string
  topic: string
  status: SessionStatus
  messageCount: number
  updatedAt: number
  createdAt: number
  agents: string[]
}

/** createSession 入参中的单个 agent */
export interface AgentInput {
  name: string
  persona?: string
}

/** createSession 入参 */
export interface CreateSessionInput {
  topic: string
  agents: [AgentInput, AgentInput]
  config?: Partial<SessionConfig>
}

/* ============================== DeepSeek ============================== */

/** DeepSeek API 原始 usage（snake_case） */
export interface DeepSeekUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** 缓存命中 token（命中按低价计费） */
  prompt_cache_hit_tokens?: number
  /** 缓存未命中 token（按高价计费） */
  prompt_cache_miss_tokens?: number
  /** 缓存写入 token（Anthropic 风格字段，少数模型按额外价计费） */
  prompt_cache_write_tokens?: number
  /** 输出 token 细分（含 reasoning） */
  completion_tokens_details?: {
    reasoning_tokens?: number
    [k: string]: unknown
  }
  [k: string]: unknown
}

/** chatCompletion / chatComplete 返回 */
export interface ChatCompletionResult {
  content: string
  reasoning: string
  usage: DeepSeekUsage
}

/* ============================== Provider ============================== */

/**
 * 价格配置（Provider 维度）。
 * - 输入、输出为必填基础项；
 * - 缓存命中默认启用（多数 Provider 有该计价维度）；
 * - 缓存写入默认关闭（仅 Anthropic 等少数模型存在该计价维度）。
 */
export interface ProviderPricing {
  /** 货币代码，如 'CNY' | 'USD'，默认 'CNY' */
  currency: string
  /** 输入（缓存未命中）单价，单位：该货币/百万 token */
  inputPerMTok: number
  /** 输出单价，单位：该货币/百万 token */
  outputPerMTok: number
  /** 是否启用缓存命中计价维度（默认 true） */
  cacheHitEnabled: boolean
  /** 缓存命中单价（通常远低于 input） */
  cacheHitPerMTok: number
  /** 是否启用缓存写入计价维度（默认 false） */
  cacheWriteEnabled: boolean
  /** 缓存写入单价（仅少数模型存在该计价维度） */
  cacheWritePerMTok: number
}

/**
 * 一个 Provider = 一套 OpenAI 兼容的连接配置。
 * 存储在 data/providers.json，可在 UI 中增删改查。
 */
export interface Provider {
  id: string
  /** 显示名，如 "DeepSeek 官方" */
  name: string
  /** API 基址，如 https://api.deepseek.com/v1 */
  baseUrl: string
  /** API 密钥（后端持有，前端列表不回显原文） */
  apiKey: string
  /** 模型 ID，如 deepseek-v4-flash */
  model: string
  /** 价格配置（货币、输入/输出/缓存单价） */
  pricing: ProviderPricing
}

/** 创建 / 更新 Provider 的入参（不含 id） */
export interface ProviderFormData {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  /** 价格配置；为可选以兼容旧入参，后端会归一化补全 */
  pricing?: Partial<ProviderPricing>
}

/**
 * 前端列表项——apiKey 打码，不暴露原文。
 * 列表 API 返回此类型，而非完整 Provider。
 */
export interface ProviderListItem {
  id: string
  name: string
  baseUrl: string
  model: string
  /** 价格配置（含货币与缓存单价） */
  pricing: ProviderPricing
  /** 打码后的 key，如 sk-***x4f2，仅供前端显示「已配置」状态 */
  apiKeyMasked: string
}

/** providers.json 的完整结构 */
export interface ProvidersFile {
  providers: Provider[]
  defaultId: string
}

/* ============================== 配置 ============================== */

/** AppConfig 的环境（宽松，不强制枚举） */
export type NodeEnv = string

/** 应用配置对象 */
export interface AppConfig {
  env: NodeEnv
  port: number
  projectRoot: string
  requestTimeoutMs: number
  absoluteMaxRounds: number
  absoluteMaxDurationSec: number
  dataDir: string
  /** Provider 配置文件路径（单文件 JSON） */
  providersFile: string
  staticDir: string
}

/* ============================== WebSocket ============================== */

/** 客户端 → 服务器 */
export type ClientToServerMsg =
  | { type: 'ping' }
  | { type: 'start' }
  | { type: 'stop' }

/** 服务器 → 客户端：连接时全量同步 */
export interface SyncMsg {
  type: 'sync'
  session: Session
}

/** 服务器 → 客户端：循环已开始 */
export interface StartedMsg {
  type: 'started'
}

/** 服务器 → 客户端：流式片段 */
export interface ChunkMsg {
  type: 'chunk'
  agentId: AgentId
  content: string
}

/** 服务器 → 客户端：一轮发言结束（附带权威 message 对象） */
export interface MessageDoneMsg {
  type: 'message_done'
  agentId: AgentId
  message: PersistedMessage
}

/** 服务器 → 客户端：摘要生命周期 */
export interface SummaryMsg {
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
export interface StatsMsg {
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
export interface TurnEndMsg {
  type: 'turn_end'
  round: number
  messageCount: number
}

/** 服务器 → 客户端：错误 */
export interface ErrorMsg {
  type: 'error'
  message: string
}

/** 服务器 → 客户端：循环结束 */
export interface FinishedMsg {
  type: 'finished'
  reason: FinishedReason
}

/** 服务器 → 客户端：心跳回复 */
export interface PongMsg {
  type: 'pong'
}

/** 所有服务器事件联合 */
export type ServerToClientMsg =
  | SyncMsg
  | StartedMsg
  | ChunkMsg
  | MessageDoneMsg
  | SummaryMsg
  | StatsMsg
  | TurnEndMsg
  | ErrorMsg
  | FinishedMsg
  | PongMsg

/** 广播函数签名 */
export type BroadcastFn = (msg: ServerToClientMsg) => void
