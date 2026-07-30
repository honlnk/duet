/**
 * localStorage 持久化层
 *
 * 草稿自动保存 + 历史预设管理。零 DOM、零网络。
 * 移植自旧版 storage.js，逻辑保持一致。
 */

/** 表单字段键（与表单值对象的 key 一一对应） */
export const FIELD_KEYS = [
  'topic',
  'agentAName',
  'agentAPersona',
  'agentBName',
  'agentBPersona',
  'model',
  'temperature',
  'maxRounds',
  'durationSec',
  'summaryEveryN',
  'keepRecent',
  'providerA',
  'providerB',
] as const

export type FieldKey = (typeof FIELD_KEYS)[number]

/** 表单值对象（所有值为字符串，与输入框一致） */
export type FormValues = Record<FieldKey, string>

const DRAFT_KEY = 'duet:draft:v1'
const HISTORY_KEY = 'duet:history:v1'
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
    return safeParse<FormValues | null>(localStorage.getItem(DRAFT_KEY), null)
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
    return safeParse<HistoryItem[]>(localStorage.getItem(HISTORY_KEY), [])
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
  return [v.topic, v.agentAName, v.agentAPersona, v.agentBName, v.agentBPersona]
    .join('|')
    .trim()
}

/** 预设显示标签 */
export function labelOf(v: FormValues): string {
  const names = `${v.agentAName || 'A'} vs ${v.agentBName || 'B'}`
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
    values: { ...values },
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
