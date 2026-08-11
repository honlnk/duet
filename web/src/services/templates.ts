/**
 * 模板持久化层（localStorage）
 *
 * 管理三类可复用模板，供「新建对话」时一键填充：
 *  - 智能体模板（AgentTemplate）：名称 + 身份设定
 *  - 话题模板（TopicTemplate）：话题文本
 *  - 世界观模板（WorldviewTemplate）：场景 + 导演指令
 *
 * 与 storage.ts（草稿/历史）同模式：零 DOM、零网络，try/catch 容错。
 */

const AGENT_TPL_KEY = 'duet:agent-templates:v1'
const TOPIC_TPL_KEY = 'duet:topic-templates:v1'
const WORLDVIEW_TPL_KEY = 'duet:worldview-templates:v1'

/** 智能体模板 */
export interface AgentTemplate {
  id: string
  name: string
  /** 综合身份描述（背景/外貌/核心设定） */
  description: string
  /** 性格关键词摘要 */
  personality: string
  createdAt: number
}

/** 话题模板 */
export interface TopicTemplate {
  id: string
  content: string
  createdAt: number
}

/** 世界观模板（场景设定） */
export interface WorldviewTemplate {
  id: string
  /** 模板名（如「校园日常」「赛博朋克」） */
  name: string
  /** 场景设定 */
  scenario: string
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

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/* --------------------------- 智能体模板 --------------------------- */

export function loadAgentTemplates(): AgentTemplate[] {
  try {
    return safeParse<AgentTemplate[]>(localStorage.getItem(AGENT_TPL_KEY), [])
  } catch {
    return []
  }
}

function saveAgentTemplates(list: AgentTemplate[]): void {
  try {
    localStorage.setItem(AGENT_TPL_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function addAgentTemplate(
  name: string,
  description: string = '',
  personality: string = '',
): AgentTemplate[] {
  const list = loadAgentTemplates()
  const item: AgentTemplate = {
    id: genId('a'),
    name: name.trim(),
    description: description.trim(),
    personality: personality.trim(),
    createdAt: Date.now(),
  }
  const next = [item, ...list]
  saveAgentTemplates(next)
  return next
}

export function updateAgentTemplate(
  id: string,
  patch: Partial<Pick<AgentTemplate, 'name' | 'description' | 'personality'>>,
): AgentTemplate[] {
  const list = loadAgentTemplates().map((t) =>
    t.id === id ? { ...t, ...patch } : t,
  )
  saveAgentTemplates(list)
  return list
}

export function removeAgentTemplate(id: string): AgentTemplate[] {
  const list = loadAgentTemplates().filter((t) => t.id !== id)
  saveAgentTemplates(list)
  return list
}

/* --------------------------- 话题模板 --------------------------- */

export function loadTopicTemplates(): TopicTemplate[] {
  try {
    return safeParse<TopicTemplate[]>(localStorage.getItem(TOPIC_TPL_KEY), [])
  } catch {
    return []
  }
}

function saveTopicTemplates(list: TopicTemplate[]): void {
  try {
    localStorage.setItem(TOPIC_TPL_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function addTopicTemplate(content: string): TopicTemplate[] {
  const list = loadTopicTemplates()
  const item: TopicTemplate = {
    id: genId('t'),
    content: content.trim(),
    createdAt: Date.now(),
  }
  const next = [item, ...list]
  saveTopicTemplates(next)
  return next
}

export function removeTopicTemplate(id: string): TopicTemplate[] {
  const list = loadTopicTemplates().filter((t) => t.id !== id)
  saveTopicTemplates(list)
  return list
}

export function updateTopicTemplate(id: string, content: string): TopicTemplate[] {
  const list = loadTopicTemplates().map((t) =>
    t.id === id ? { ...t, content: content.trim() } : t,
  )
  saveTopicTemplates(list)
  return list
}

/* --------------------------- 世界观模板 --------------------------- */

export function loadWorldviewTemplates(): WorldviewTemplate[] {
  try {
    return safeParse<WorldviewTemplate[]>(localStorage.getItem(WORLDVIEW_TPL_KEY), [])
  } catch {
    return []
  }
}

function saveWorldviewTemplates(list: WorldviewTemplate[]): void {
  try {
    localStorage.setItem(WORLDVIEW_TPL_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function addWorldviewTemplate(
  name: string,
  scenario: string,
): WorldviewTemplate[] {
  const list = loadWorldviewTemplates()
  const item: WorldviewTemplate = {
    id: genId('w'),
    name: name.trim(),
    scenario: scenario.trim(),
    createdAt: Date.now(),
  }
  const next = [item, ...list]
  saveWorldviewTemplates(next)
  return next
}

export function removeWorldviewTemplate(id: string): WorldviewTemplate[] {
  const list = loadWorldviewTemplates().filter((t) => t.id !== id)
  saveWorldviewTemplates(list)
  return list
}

export function updateWorldviewTemplate(
  id: string,
  patch: Partial<Pick<WorldviewTemplate, 'name' | 'scenario'>>,
): WorldviewTemplate[] {
  const list = loadWorldviewTemplates().map((t) =>
    t.id === id ? { ...t, ...patch } : t,
  )
  saveWorldviewTemplates(list)
  return list
}
