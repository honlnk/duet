/**
 * 本地缓存：草稿持久化 + 历史预设。
 * 全部用 localStorage，避免测试阶段重复输入。
 */

const DRAFT_KEY = 'duet:draft:v1'
const HISTORY_KEY = 'duet:history:v1'
const MAX_HISTORY = 20

/**
 * 表单字段清单（与 ui.js 的 els 一致）。
 * value 为字符串形式（select/number 也按字符串存）。
 */
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
]

/* ============ 草稿（实时保存/恢复） ============ */

export function saveDraft(values) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(values))
  } catch {}
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {}
}

/* ============ 历史预设（成功发起过的配置） ============ */

/**
 * @typedef {Object} HistoryItem
 * @property {string} id
 * @property {number} ts
 * @property {string} label  话题前缀，用于下拉显示
 * @property {Object} values 完整字段值
 */

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {}
}

/**
 * 追加一条历史（去重：相同 topic+agents 只保留最新）
 */
export function addHistory(values) {
  const list = loadHistory()
  const sig = signature(values)
  const filtered = list.filter((it) => signature(it.values) !== sig)
  filtered.unshift({
    id: 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    label: labelOf(values),
    values,
  })
  while (filtered.length > MAX_HISTORY) filtered.pop()
  saveHistory(filtered)
  return filtered
}

export function removeHistory(id) {
  const list = loadHistory().filter((it) => it.id !== id)
  saveHistory(list)
  return list
}

export function clearHistory() {
  saveHistory([])
}

function signature(v) {
  return [v.topic, v.agentAName, v.agentAPersona, v.agentBName, v.agentBPersona].join('||')
}

function labelOf(v) {
  const t = (v.topic || '').slice(0, 24)
  const a = v.agentAName || 'A'
  const b = v.agentBName || 'B'
  return `${a} vs ${b} · ${t}`
}
