/**
 * 模板持久化层（localStorage）
 *
 * 管理三类可复用模板，供「新建对话」时一键填充：
 *  - 角色模板（CharacterTemplate）：名称 + 身份设定
 *  - 话题模板（TopicTemplate）：话题文本
 *  - 世界观模板（WorldviewTemplate）：场景 + 导演指令
 *
 * 与 storage.ts（草稿/历史）同模式：零 DOM、零网络，try/catch 容错。
 */

const CHARACTER_TPL_KEY = 'duet:character-templates:v1'
/** 旧版键（智能体概念时期），首次读取时一次性迁移到新键 */
const LEGACY_CHARACTER_TPL_KEY = 'duet:agent-templates:v1'
const TOPIC_TPL_KEY = 'duet:topic-templates:v1'
const WORLDVIEW_TPL_KEY = 'duet:worldview-templates:v1'

/** 角色模板 */
export interface CharacterTemplate {
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

/* --------------------------- 角色模板 --------------------------- */

export function loadCharacterTemplates(): CharacterTemplate[] {
  try {
    const raw = localStorage.getItem(CHARACTER_TPL_KEY)
    if (raw == null) {
      // 旧键迁移：把智能体时期的模板搬到新键，然后移除旧键
      const legacy = localStorage.getItem(LEGACY_CHARACTER_TPL_KEY)
      if (legacy != null) {
        const list = safeParse<CharacterTemplate[]>(legacy, [])
        saveCharacterTemplates(list)
        localStorage.removeItem(LEGACY_CHARACTER_TPL_KEY)
        return list
      }
      return []
    }
    return safeParse<CharacterTemplate[]>(raw, [])
  } catch {
    return []
  }
}

function saveCharacterTemplates(list: CharacterTemplate[]): void {
  try {
    localStorage.setItem(CHARACTER_TPL_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function addCharacterTemplate(
  name: string,
  description: string = '',
  personality: string = '',
): CharacterTemplate[] {
  const list = loadCharacterTemplates()
  const item: CharacterTemplate = {
    id: genId('a'),
    name: name.trim(),
    description: description.trim(),
    personality: personality.trim(),
    createdAt: Date.now(),
  }
  const next = [item, ...list]
  saveCharacterTemplates(next)
  return next
}

export function updateCharacterTemplate(
  id: string,
  patch: Partial<Pick<CharacterTemplate, 'name' | 'description' | 'personality'>>,
): CharacterTemplate[] {
  const list = loadCharacterTemplates().map((t) =>
    t.id === id ? { ...t, ...patch } : t,
  )
  saveCharacterTemplates(list)
  return list
}

export function removeCharacterTemplate(id: string): CharacterTemplate[] {
  const list = loadCharacterTemplates().filter((t) => t.id !== id)
  saveCharacterTemplates(list)
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
