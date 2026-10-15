/**
 * 模板服务层（REST，服务端 data/library.json）
 *
 * 管理三类可复用模板，供「新建对话」时一键填充：
 *  - 角色模板（CharacterTemplate）：名称 + 身份设定
 *  - 话题模板（TopicTemplate）：话题文本
 *  - 世界观模板（WorldviewTemplate）：场景设定
 *
 * v2：持久化从 localStorage 迁到服务端（GET/POST/PUT/DELETE /api/templates/*），
 * 所有函数变为 async；旧 localStorage 数据由 services/libraryMigration.ts 一次性导入。
 */
import { request } from './api'

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

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/* --------------------------- 角色模板 --------------------------- */

export function loadCharacterTemplates(): Promise<CharacterTemplate[]> {
  return request<CharacterTemplate[]>('/api/templates/characters')
}

export function addCharacterTemplate(
  name: string,
  description: string = '',
  personality: string = '',
): Promise<CharacterTemplate> {
  return request<CharacterTemplate>('/api/templates/characters', jsonInit('POST', {
    name: name.trim(),
    description: description.trim(),
    personality: personality.trim(),
  }))
}

export function updateCharacterTemplate(
  id: string,
  patch: Partial<Pick<CharacterTemplate, 'name' | 'description' | 'personality'>>,
): Promise<CharacterTemplate> {
  return request<CharacterTemplate>(`/api/templates/characters/${id}`, jsonInit('PUT', {
    name: patch.name?.trim(),
    description: patch.description?.trim() ?? '',
    personality: patch.personality?.trim() ?? '',
  }))
}

export function removeCharacterTemplate(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/templates/characters/${id}`, { method: 'DELETE' })
}

/* --------------------------- 话题模板 --------------------------- */

export function loadTopicTemplates(): Promise<TopicTemplate[]> {
  return request<TopicTemplate[]>('/api/templates/topics')
}

export function addTopicTemplate(content: string): Promise<TopicTemplate> {
  return request<TopicTemplate>('/api/templates/topics', jsonInit('POST', {
    content: content.trim(),
  }))
}

export function updateTopicTemplate(id: string, content: string): Promise<TopicTemplate> {
  return request<TopicTemplate>(`/api/templates/topics/${id}`, jsonInit('PUT', {
    content: content.trim(),
  }))
}

export function removeTopicTemplate(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/templates/topics/${id}`, { method: 'DELETE' })
}

/* --------------------------- 世界观模板 --------------------------- */

export function loadWorldviewTemplates(): Promise<WorldviewTemplate[]> {
  return request<WorldviewTemplate[]>('/api/templates/worldviews')
}

export function addWorldviewTemplate(
  name: string,
  scenario: string,
): Promise<WorldviewTemplate> {
  return request<WorldviewTemplate>('/api/templates/worldviews', jsonInit('POST', {
    name: name.trim(),
    scenario: scenario.trim(),
  }))
}

export function updateWorldviewTemplate(
  id: string,
  patch: Partial<Pick<WorldviewTemplate, 'name' | 'scenario'>>,
): Promise<WorldviewTemplate> {
  return request<WorldviewTemplate>(`/api/templates/worldviews/${id}`, jsonInit('PUT', {
    name: patch.name?.trim(),
    scenario: patch.scenario?.trim() ?? '',
  }))
}

export function removeWorldviewTemplate(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/templates/worldviews/${id}`, { method: 'DELETE' })
}
