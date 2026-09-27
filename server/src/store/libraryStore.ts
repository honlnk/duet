/**
 * 资产库持久化层（data/library.json）
 *
 * 管理从浏览器 localStorage 迁移来的四类资产 + 关系图节点坐标：
 *  - 角色模板 / 话题模板 / 世界观模板
 *  - 角色间非对称关系（Key: "{fromTemplateId}->{toTemplateId}"）
 *
 * 与 providerStore 同模式：单进程内存权威 + 变更即落盘（tmp+rename 原子写）。
 * REST 路由（给前端）与 Agent 工具（给导演 Agent 循环）共用本模块，
 * Agent 工具只调用这里的内存函数，绝不直接碰文件系统。
 */
import fs from 'node:fs'
import path from 'node:path'
import config from '../config.js'
import type {
  CharacterTemplate,
  CharacterTemplateInput,
  LibraryData,
  LibraryImportPayload,
  LibraryImportResult,
  NodePosition,
  TopicTemplate,
  TopicTemplateInput,
  WorldviewTemplate,
  WorldviewTemplateInput,
} from '../types/index.js'

function emptyLibrary(): LibraryData {
  return {
    characterTemplates: [],
    topicTemplates: [],
    worldviewTemplates: [],
    relationships: {},
    nodePositions: {},
  }
}

/** 模块级内存态（首次访问时从磁盘加载） */
let data: LibraryData | null = null

function load(): LibraryData {
  if (data) return data
  const file = config.libraryFile
  if (!fs.existsSync(file)) {
    data = emptyLibrary()
    return data
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LibraryData>
    data = {
      characterTemplates: Array.isArray(parsed.characterTemplates) ? parsed.characterTemplates : [],
      topicTemplates: Array.isArray(parsed.topicTemplates) ? parsed.topicTemplates : [],
      worldviewTemplates: Array.isArray(parsed.worldviewTemplates) ? parsed.worldviewTemplates : [],
      relationships: parsed.relationships && typeof parsed.relationships === 'object' ? parsed.relationships : {},
      nodePositions: parsed.nodePositions && typeof parsed.nodePositions === 'object' ? parsed.nodePositions : {},
    }
  } catch (e) {
    console.error('[library] 资产库文件损坏，从空库启动:', e instanceof Error ? e.message : e)
    data = emptyLibrary()
  }
  return data
}

/** 原子落盘（每次变更后调用） */
function save(): void {
  const lib = load()
  const dir = path.dirname(config.libraryFile)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = config.libraryFile + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(lib, null, 2), 'utf8')
  fs.renameSync(tmp, config.libraryFile)
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback)

/* --------------------------- 角色模板 --------------------------- */

export function listCharacterTemplates(): CharacterTemplate[] {
  return [...load().characterTemplates]
}

export function upsertCharacterTemplate(input: CharacterTemplateInput): CharacterTemplate {
  const lib = load()
  const name = str(input.name)
  if (!name) throw new Error('角色模板的 name 不能为空')

  if (input.id) {
    const existing = lib.characterTemplates.find((t) => t.id === input.id)
    if (!existing) throw new Error(`角色模板不存在: ${input.id}`)
    existing.name = name
    existing.description = str(input.description)
    existing.personality = str(input.personality)
    save()
    return { ...existing }
  }

  const created: CharacterTemplate = {
    id: genId('ct'),
    name,
    description: str(input.description),
    personality: str(input.personality),
    createdAt: Date.now(),
  }
  lib.characterTemplates.push(created)
  save()
  return { ...created }
}

export function deleteCharacterTemplate(id: string): boolean {
  const lib = load()
  const idx = lib.characterTemplates.findIndex((t) => t.id === id)
  if (idx < 0) return false
  lib.characterTemplates.splice(idx, 1)
  // 级联清理：关系两端引用该模板的条目 + 该模板的画布节点坐标
  for (const key of Object.keys(lib.relationships)) {
    const [from, to] = key.split('->')
    if (from === id || to === id) delete lib.relationships[key]
  }
  delete lib.nodePositions[id]
  save()
  return true
}

/* --------------------------- 话题模板 --------------------------- */

export function listTopicTemplates(): TopicTemplate[] {
  return [...load().topicTemplates]
}

export function upsertTopicTemplate(input: TopicTemplateInput): TopicTemplate {
  const lib = load()
  const content = str(input.content)
  if (!content) throw new Error('话题模板的 content 不能为空')

  if (input.id) {
    const existing = lib.topicTemplates.find((t) => t.id === input.id)
    if (!existing) throw new Error(`话题模板不存在: ${input.id}`)
    existing.content = content
    save()
    return { ...existing }
  }

  const created: TopicTemplate = { id: genId('tt'), content, createdAt: Date.now() }
  lib.topicTemplates.push(created)
  save()
  return { ...created }
}

export function deleteTopicTemplate(id: string): boolean {
  const lib = load()
  const idx = lib.topicTemplates.findIndex((t) => t.id === id)
  if (idx < 0) return false
  lib.topicTemplates.splice(idx, 1)
  save()
  return true
}

/* --------------------------- 世界观模板 --------------------------- */

export function listWorldviewTemplates(): WorldviewTemplate[] {
  return [...load().worldviewTemplates]
}

export function upsertWorldviewTemplate(input: WorldviewTemplateInput): WorldviewTemplate {
  const lib = load()
  const name = str(input.name)
  if (!name) throw new Error('世界观模板的 name 不能为空')

  if (input.id) {
    const existing = lib.worldviewTemplates.find((t) => t.id === input.id)
    if (!existing) throw new Error(`世界观模板不存在: ${input.id}`)
    existing.name = name
    existing.scenario = str(input.scenario)
    save()
    return { ...existing }
  }

  const created: WorldviewTemplate = {
    id: genId('wt'),
    name,
    scenario: str(input.scenario),
    createdAt: Date.now(),
  }
  lib.worldviewTemplates.push(created)
  save()
  return { ...created }
}

export function deleteWorldviewTemplate(id: string): boolean {
  const lib = load()
  const idx = lib.worldviewTemplates.findIndex((t) => t.id === id)
  if (idx < 0) return false
  lib.worldviewTemplates.splice(idx, 1)
  save()
  return true
}

/* --------------------------- 关系 + 节点坐标 --------------------------- */

export function getRelationships(): { relationships: Record<string, string>; nodePositions: Record<string, NodePosition> } {
  const lib = load()
  return {
    relationships: { ...lib.relationships },
    nodePositions: JSON.parse(JSON.stringify(lib.nodePositions)) as Record<string, NodePosition>,
  }
}

/** 整体覆盖（关系图画布批量保存用） */
export function setRelationships(
  relationships: Record<string, string>,
  nodePositions?: Record<string, NodePosition>,
): void {
  const lib = load()
  lib.relationships = cleanRelationships(relationships)
  if (nodePositions && typeof nodePositions === 'object') {
    lib.nodePositions = nodePositions
  }
  save()
}

/** 设置一条有向关系（Agent 工具粒度） */
export function setRelationship(fromTemplateId: string, toTemplateId: string, description: string): void {
  const lib = load()
  if (!fromTemplateId || !toTemplateId) throw new Error('关系两端的角色模板 id 不能为空')
  if (fromTemplateId === toTemplateId) throw new Error('不能设置指向自己的关系')
  lib.relationships[`${fromTemplateId}->${toTemplateId}`] = description
  save()
}

/** 删除一条有向关系（Agent 工具粒度） */
export function deleteRelationship(fromTemplateId: string, toTemplateId: string): boolean {
  const lib = load()
  const key = `${fromTemplateId}->${toTemplateId}`
  if (!(key in lib.relationships)) return false
  delete lib.relationships[key]
  save()
  return true
}

/** 清理关系：移除指向自身的、值为空的条目 */
function cleanRelationships(rels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(rels)) {
    const [from, to] = key.split('->')
    if (!from || !to || from === to) continue
    if (typeof value !== 'string' || !value.trim()) continue
    out[key] = value
  }
  return out
}

/* --------------------------- 迁移导入 --------------------------- */

/** 资产库是否为空（前端据此判断是否需要触发 localStorage 迁移） */
export function libraryIsEmpty(): boolean {
  const lib = load()
  return (
    lib.characterTemplates.length === 0 &&
    lib.topicTemplates.length === 0 &&
    lib.worldviewTemplates.length === 0 &&
    Object.keys(lib.relationships).length === 0
  )
}

/**
 * 一次性迁移导入（前端 localStorage → 服务端）。
 * 按 id upsert：同 id 更新、新 id 追加，幂等（重复导入不产生重复数据）。
 */
export function importLibrary(payload: LibraryImportPayload): LibraryImportResult {
  const lib = load()
  const result: LibraryImportResult = { characters: 0, topics: 0, worldviews: 0, relationships: 0 }

  for (const raw of payload.characterTemplates ?? []) {
    if (!raw?.id || !str(raw.name)) continue
    const existing = lib.characterTemplates.find((t) => t.id === raw.id)
    if (existing) {
      existing.name = str(raw.name)
      existing.description = str(raw.description)
      existing.personality = str(raw.personality)
    } else {
      lib.characterTemplates.push({
        id: raw.id,
        name: str(raw.name),
        description: str(raw.description),
        personality: str(raw.personality),
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      })
    }
    result.characters++
  }

  for (const raw of payload.topicTemplates ?? []) {
    if (!raw?.id || !str(raw.content)) continue
    const existing = lib.topicTemplates.find((t) => t.id === raw.id)
    if (existing) {
      existing.content = str(raw.content)
    } else {
      lib.topicTemplates.push({
        id: raw.id,
        content: str(raw.content),
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      })
    }
    result.topics++
  }

  for (const raw of payload.worldviewTemplates ?? []) {
    if (!raw?.id || !str(raw.name)) continue
    const existing = lib.worldviewTemplates.find((t) => t.id === raw.id)
    if (existing) {
      existing.name = str(raw.name)
      existing.scenario = str(raw.scenario)
    } else {
      lib.worldviewTemplates.push({
        id: raw.id,
        name: str(raw.name),
        scenario: str(raw.scenario),
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      })
    }
    result.worldviews++
  }

  if (payload.relationships && typeof payload.relationships === 'object') {
    Object.assign(lib.relationships, cleanRelationships(payload.relationships))
    result.relationships = Object.keys(payload.relationships).length
  }

  if (payload.nodePositions && typeof payload.nodePositions === 'object') {
    Object.assign(lib.nodePositions, payload.nodePositions)
  }

  save()
  return result
}

/* --------------------------- 测试辅助 --------------------------- */

/** 重置内存态并指向指定文件（仅测试用） */
export function _resetForTest(file: string): void {
  data = null
  ;(config as { libraryFile?: string }).libraryFile = file
}
