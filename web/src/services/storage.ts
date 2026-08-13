/**
 * localStorage 持久化层
 *
 * 草稿自动保存 + 历史预设管理。零 DOM、零网络。
 *
 * v2：智能体配置从固定 A/B 改为动态数组（2~3 个，含颜色与各自 Provider）。
 */

import type { AgentColor } from '@/types/api'
import { DEFAULT_AGENT_COLORS, MAX_AGENTS, MIN_AGENTS } from '@/types/api'

/** 单个智能体的表单字段（草稿/历史中的形态） */
export interface AgentFormValues {
  name: string
  /** 综合身份描述（背景/外貌/核心设定） */
  description: string
  /** 性格关键词摘要 */
  personality: string
  color: AgentColor
  /** Provider id（空串 = 默认 Provider） */
  provider: string
  /** 思考档位 key（空串 = 用 Provider 默认配置） */
  thinking: string
  /** 所选智能体模板 id（空串 = 未选择模板，手填或待选） */
  templateId: string
}

/** 表单值对象 */
export interface FormValues {
  topic: string
  /** 所选话题模板 id（空串 = 未选择模板） */
  topicTemplateId: string
  /** 场景设定 / 世界观 */
  scenario: string
  /** 所选世界观模板 id（空串 = 未选择模板） */
  worldviewTemplateId: string
  model: string
  temperature: string
  maxRounds: string
  durationSec: string
  summaryEveryN: string
  keepRecent: string
  /** 智能体列表（长度 2~3） */
  agents: AgentFormValues[]
  /** 非对称关系图：Key "{fromId}->{toId}" */
  relationships: Record<string, string>
}

/** 通用配置字段的键（不含 agents，agents 是数组单独管理） */
export const SCALAR_FIELD_KEYS = [
  'topic',
  'scenario',
  'model',
  'temperature',
  'maxRounds',
  'durationSec',
  'summaryEveryN',
  'keepRecent',
] as const

export type ScalarFieldKey = (typeof SCALAR_FIELD_KEYS)[number]

const DRAFT_KEY = 'duet:draft:v2'
const HISTORY_KEY = 'duet:history:v2'
const MAX_HISTORY = 20

/** 历史预设项 */
export interface HistoryItem {
  id: string
  values: FormValues
  createdAt: number
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** 生成一个默认智能体表单项（未选模板的占位） */
export function makeAgent(index: number, over?: Partial<AgentFormValues>): AgentFormValues {
  return {
    name: '',
    description: '',
    personality: '',
    color: over?.color || DEFAULT_AGENT_COLORS[index] || 'blue',
    provider: '',
    thinking: '',
    templateId: '',
    ...over,
  }
}

/** 默认表单值（2 个空智能体） */
export function defaultValues(): FormValues {
  return {
    topic: '',
    topicTemplateId: '',
    scenario: '',
    worldviewTemplateId: '',
    model: 'deepseek-v4-flash',
    temperature: '0.7',
    maxRounds: '',
    durationSec: '',
    summaryEveryN: '10',
    keepRecent: '8',
    agents: [makeAgent(0), makeAgent(1)],
    relationships: {},
  }
}

/* ----------------------------- 草稿 ----------------------------- */

export function saveDraft(values: FormValues): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(values))
  } catch {
    /* 配额满或禁用存储，忽略 */
  }
}

export function loadDraft(): FormValues | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = safeParse<FormValues | null>(raw, null)
    if (!parsed) return null
    return normalizeValues(parsed)
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

/* --------------------------- 历史预设 --------------------------- */

function saveHistory(list: HistoryItem[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function loadHistory(): HistoryItem[] {
  try {
    const list = safeParse<HistoryItem[]>(localStorage.getItem(HISTORY_KEY), [])
    return list.map((h) => ({ ...h, values: normalizeValues(h.values) }))
  } catch {
    return []
  }
}

/** 生成历史 id */
function genId(): string {
  return 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 用关键字段拼接签名用于去重 */
function signature(v: FormValues): string {
  const agentsSig = v.agents.map((a) => `${a.name}|${a.description}`).join('||')
  return `${v.topic}|${agentsSig}`.trim()
}

/** 预设显示标签 */
export function labelOf(v: FormValues): string {
  const names = v.agents.map((a) => a.name || '?').join(' vs ')
  const topicPrefix = (v.topic || '').slice(0, 20)
  return topicPrefix ? `${names} · ${topicPrefix}` : names
}

/**
 * 添加一条历史。按签名去重（保留最新），上限 MAX_HISTORY。
 */
export function addHistory(values: FormValues): HistoryItem[] {
  const list = loadHistory()
  const sig = signature(values)
  // 移除同签名的旧项
  const filtered = list.filter((item) => signature(item.values) !== sig)
  const item: HistoryItem = {
    id: genId(),
    values,
    createdAt: Date.now(),
  }
  const next = [item, ...filtered].slice(0, MAX_HISTORY)
  saveHistory(next)
  return next
}

export function removeHistory(id: string): HistoryItem[] {
  const list = loadHistory().filter((item) => item.id !== id)
  saveHistory(list)
  return list
}

export function clearHistory(): void {
  saveHistory([])
}

/**
 * 归一化表单值（容错）：
 * - 补全缺失的标量字段为字符串；
 * - agents 数组至少 MIN_AGENTS、至多 MAX_AGENTS，缺字段补默认。
 *
 * 入参用宽松类型，兼容 FormValues 与未知结构混合输入。
 */
export function normalizeValues(input: FormValues | Record<string, unknown>): FormValues {
  const anyInput = input as Record<string, unknown>
  const def = defaultValues()
  const out: FormValues = {
    topic: str(anyInput.topic, def.topic),
    topicTemplateId: str(anyInput.topicTemplateId, def.topicTemplateId),
    scenario: str(anyInput.scenario, def.scenario),
    worldviewTemplateId: str(anyInput.worldviewTemplateId, def.worldviewTemplateId),
    model: str(anyInput.model, def.model),
    temperature: str(anyInput.temperature, def.temperature),
    maxRounds: str(anyInput.maxRounds, def.maxRounds),
    durationSec: str(anyInput.durationSec, def.durationSec),
    summaryEveryN: str(anyInput.summaryEveryN, def.summaryEveryN),
    keepRecent: str(anyInput.keepRecent, def.keepRecent),
    agents: [],
    relationships: obj(anyInput.relationships) as Record<string, string>,
  }

  if (Array.isArray(anyInput.agents) && anyInput.agents.length > 0) {
    out.agents = (anyInput.agents as Array<Partial<AgentFormValues>>)
      .slice(0, MAX_AGENTS)
      .map((a, i) => ({
        name: str(a?.name, ''),
        description: str(a?.description, ''),
        personality: str(a?.personality, ''),
        color: (isValidColor(a?.color) ? a?.color : def.agents[i]?.color || 'blue') as AgentColor,
        provider: str(a?.provider, ''),
        thinking: str(a?.thinking, ''),
        templateId: str(a?.templateId, ''),
      }))
  }

  // 保证长度合法
  while (out.agents.length < MIN_AGENTS) out.agents.push(makeAgent(out.agents.length))
  out.agents = out.agents.slice(0, MAX_AGENTS)
  return out
}

function str(v: unknown, fallback: string): string {
  if (v == null) return fallback
  const s = String(v)
  return s
}

/** 安全提取对象（用于 relationships 等 Record 类型字段） */
function obj(v: unknown): Record<string, string> {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return {}
  return v as Record<string, string>
}

/** 合法颜色：预设 key 或 hex（#rgb / #rrggbb） */
const HEX_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/
function isValidColor(c: unknown): c is AgentColor {
  if (typeof c !== 'string') return false
  if (['blue', 'pink', 'green', 'amber', 'purple', 'teal'].includes(c)) return true
  return HEX_RE.test(c)
}
