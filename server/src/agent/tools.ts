/**
 * 导演 Agent 的工具表：对资产库（模板 + 关系）的增删改查。
 *
 * 与 NovAI 文件工具的本质区别：这里每个工具只调用 libraryStore 的内存函数，
 * 绝不接触文件系统；schema 用 OpenAI function-calling 格式（适配器负责转线格式）。
 *
 * 写操作统一 upsert 语义（id 空 = 新建，非空 = 更新），降低模型出错率。
 */
import type { AgentToolSchema } from '../types/index.js'
import {
  deleteCharacterTemplate,
  deleteRelationship,
  deleteTopicTemplate,
  deleteWorldviewTemplate,
  getRelationships,
  listCharacterTemplates,
  listTopicTemplates,
  listWorldviewTemplates,
  setRelationship,
  upsertCharacterTemplate,
  upsertTopicTemplate,
  upsertWorldviewTemplate,
} from '../store/libraryStore.js'

/** 单个工具定义 */
export interface AgentToolDef {
  name: string
  /** 是否为写操作（前端据此刷新资产缓存） */
  isWrite: boolean
  schema: AgentToolSchema
  /** 参数校验（不合法直接抛错，错误文本会回灌给模型） */
  validate(input: Record<string, unknown>): Record<string, unknown>
  /** 执行并返回回灌给模型的文本 */
  run(input: Record<string, unknown>): Promise<string>
  /** 给 UI 的一句话摘要 */
  summarize(input: Record<string, unknown>): string
}

/* --------------------------- 校验工具 --------------------------- */

function reqStr(input: Record<string, unknown>, key: string): string {
  const v = input[key]
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`参数 ${key} 必须是非空字符串`)
  }
  return v.trim()
}

function optStr(input: Record<string, unknown>, key: string): string {
  const v = input[key]
  return typeof v === 'string' ? v.trim() : ''
}

function objSchema(name: string, description: string, properties: Record<string, unknown>, required: string[]): AgentToolSchema {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  }
}

/** 校验角色模板 id 存在（关系类工具用），不存在时列出全部合法 id */
function assertTemplateExists(id: string, label: string): void {
  const all = listCharacterTemplates()
  if (!all.some((t) => t.id === id)) {
    const hint = all.length
      ? `当前角色模板：${all.map((t) => `${t.name}(${t.id})`).join('、')}`
      : '当前没有任何角色模板'
    throw new Error(`${label} ${id} 不存在。${hint}`)
  }
}

/* --------------------------- 工具实现 --------------------------- */

const listCharacterTemplatesTool: AgentToolDef = {
  name: 'list_character_templates',
  isWrite: false,
  schema: objSchema(
    'list_character_templates',
    '列出全部角色模板（含 id、名称、身份描述、性格）。修改或删除前先调用它确认现状。',
    {},
    [],
  ),
  validate: () => ({}),
  run: async () => {
    const list = listCharacterTemplates()
    if (list.length === 0) return '当前没有任何角色模板。'
    const lines = list.map(
      (t) => `- [${t.id}] ${t.name}｜身份：${t.description || '（未填）'}｜性格：${t.personality || '（未填）'}`,
    )
    return `共 ${list.length} 个角色模板：\n${lines.join('\n')}`
  },
  summarize: () => '查看角色模板列表',
}

const upsertCharacterTemplateTool: AgentToolDef = {
  name: 'upsert_character_template',
  isWrite: true,
  schema: objSchema(
    'upsert_character_template',
    '创建或更新角色模板。id 留空 = 新建；传 id = 更新（name/description/personality 全量覆盖，未传的字段会清空，先 list 查询再改）。',
    {
      id: { type: 'string', description: '目标模板 id；新建时不传' },
      name: { type: 'string', description: '角色名（如「小张」）' },
      description: { type: 'string', description: '综合身份描述：背景/外貌/核心设定，一段中文' },
      personality: { type: 'string', description: '性格关键词摘要' },
    },
    ['name'],
  ),
  validate: (input) => ({
    id: optStr(input, 'id'),
    name: reqStr(input, 'name'),
    description: optStr(input, 'description'),
    personality: optStr(input, 'personality'),
  }),
  run: async (input) => {
    const t = upsertCharacterTemplate(input as { id?: string; name: string; description?: string; personality?: string })
    return input.id
      ? `已更新角色模板「${t.name}」(${t.id})。`
      : `已创建角色模板「${t.name}」(${t.id})。`
  },
  summarize: (input) => (input.id ? `更新角色模板 ${String(input.id)}` : `新建角色模板「${String(input.name ?? '')}」`),
}

const deleteCharacterTemplateTool: AgentToolDef = {
  name: 'delete_character_template',
  isWrite: true,
  schema: objSchema(
    'delete_character_template',
    '删除角色模板（其参与的关系和画布坐标会一并清理）。删除是不可逆的，确认用户意图明确后再调用。',
    { id: { type: 'string', description: '要删除的角色模板 id' } },
    ['id'],
  ),
  validate: (input) => ({ id: reqStr(input, 'id') }),
  run: async (input) => {
    const ok = deleteCharacterTemplate(String(input.id))
    return ok ? `已删除角色模板 ${input.id}。` : `未找到 id 为 ${input.id} 的角色模板。`
  },
  summarize: (input) => `删除角色模板 ${String(input.id)}`,
}

const listTopicTemplatesTool: AgentToolDef = {
  name: 'list_topic_templates',
  isWrite: false,
  schema: objSchema('list_topic_templates', '列出全部话题模板（对话的开场引子文本）。', {}, []),
  validate: () => ({}),
  run: async () => {
    const list = listTopicTemplates()
    if (list.length === 0) return '当前没有任何话题模板。'
    return `共 ${list.length} 个话题模板：\n${list.map((t) => `- [${t.id}] ${t.content}`).join('\n')}`
  },
  summarize: () => '查看话题模板列表',
}

const upsertTopicTemplateTool: AgentToolDef = {
  name: 'upsert_topic_template',
  isWrite: true,
  schema: objSchema(
    'upsert_topic_template',
    '创建或更新话题模板。id 留空 = 新建；传 id = 更新（content 全量覆盖）。',
    {
      id: { type: 'string', description: '目标模板 id；新建时不传' },
      content: { type: 'string', description: '话题文本（如「讨论是否应该立法禁止 AI 生成未标注内容」）' },
    },
    ['content'],
  ),
  validate: (input) => ({ id: optStr(input, 'id'), content: reqStr(input, 'content') }),
  run: async (input) => {
    const t = upsertTopicTemplate(input as { id?: string; content: string })
    return input.id ? `已更新话题模板 (${t.id})。` : `已创建话题模板 (${t.id})。`
  },
  summarize: (input) => (input.id ? `更新话题模板 ${input.id}` : '新建话题模板'),
}

const deleteTopicTemplateTool: AgentToolDef = {
  name: 'delete_topic_template',
  isWrite: true,
  schema: objSchema(
    'delete_topic_template',
    '删除话题模板。删除是不可逆的，确认用户意图明确后再调用。',
    { id: { type: 'string', description: '要删除的话题模板 id' } },
    ['id'],
  ),
  validate: (input) => ({ id: reqStr(input, 'id') }),
  run: async (input) => {
    const ok = deleteTopicTemplate(String(input.id))
    return ok ? `已删除话题模板 ${input.id}。` : `未找到 id 为 ${input.id} 的话题模板。`
  },
  summarize: (input) => `删除话题模板 ${String(input.id)}`,
}

const listWorldviewTemplatesTool: AgentToolDef = {
  name: 'list_worldview_templates',
  isWrite: false,
  schema: objSchema('list_worldview_templates', '列出全部世界观模板（场景设定）。', {}, []),
  validate: () => ({}),
  run: async () => {
    const list = listWorldviewTemplates()
    if (list.length === 0) return '当前没有任何世界观模板。'
    return `共 ${list.length} 个世界观模板：\n${list.map((t) => `- [${t.id}] ${t.name}｜${t.scenario || '（未填场景）'}`).join('\n')}`
  },
  summarize: () => '查看世界观模板列表',
}

const upsertWorldviewTemplateTool: AgentToolDef = {
  name: 'upsert_worldview_template',
  isWrite: true,
  schema: objSchema(
    'upsert_worldview_template',
    '创建或更新世界观模板。id 留空 = 新建；传 id = 更新（name/scenario 全量覆盖）。',
    {
      id: { type: 'string', description: '目标模板 id；新建时不传' },
      name: { type: 'string', description: '模板名（如「校园日常」「赛博朋克」）' },
      scenario: { type: 'string', description: '场景设定正文' },
    },
    ['name'],
  ),
  validate: (input) => ({ id: optStr(input, 'id'), name: reqStr(input, 'name'), scenario: optStr(input, 'scenario') }),
  run: async (input) => {
    const t = upsertWorldviewTemplate(input as { id?: string; name: string; scenario?: string })
    return input.id ? `已更新世界观模板「${t.name}」(${t.id})。` : `已创建世界观模板「${t.name}」(${t.id})。`
  },
  summarize: (input) => (input.id ? `更新世界观模板 ${input.id}` : `新建世界观模板「${String(input.name ?? '')}」`),
}

const deleteWorldviewTemplateTool: AgentToolDef = {
  name: 'delete_worldview_template',
  isWrite: true,
  schema: objSchema(
    'delete_worldview_template',
    '删除世界观模板。删除是不可逆的，确认用户意图明确后再调用。',
    { id: { type: 'string', description: '要删除的世界观模板 id' } },
    ['id'],
  ),
  validate: (input) => ({ id: reqStr(input, 'id') }),
  run: async (input) => {
    const ok = deleteWorldviewTemplate(String(input.id))
    return ok ? `已删除世界观模板 ${input.id}。` : `未找到 id 为 ${input.id} 的世界观模板。`
  },
  summarize: (input) => `删除世界观模板 ${String(input.id)}`,
}

const listRelationshipsTool: AgentToolDef = {
  name: 'list_relationships',
  isWrite: false,
  schema: objSchema(
    'list_relationships',
    '列出角色模板之间的全部关系。关系是有向的：A→B 表示 A 视角对 B 的关系描述。',
    {},
    [],
  ),
  validate: () => ({}),
  run: async () => {
    const { relationships } = getRelationships()
    const names = new Map(listCharacterTemplates().map((t) => [t.id, t.name]))
    const keys = Object.keys(relationships)
    if (keys.length === 0) return '当前没有任何角色关系。'
    const lines = keys.map((key) => {
      const [from, to] = key.split('->')
      return `- ${names.get(from!) ?? from} → ${names.get(to!) ?? to}（${key}）：${relationships[key] || '（描述未填）'}`
    })
    return `共 ${keys.length} 条有向关系：\n${lines.join('\n')}`
  },
  summarize: () => '查看角色关系列表',
}

const setRelationshipTool: AgentToolDef = {
  name: 'set_relationship',
  isWrite: true,
  schema: objSchema(
    'set_relationship',
    '设置一条有向关系（A 视角对 B 的描述）。一对双向关系需要调用两次（A→B 和 B→A 各一条，视角描述通常不同）。',
    {
      fromTemplateId: { type: 'string', description: '视角方的角色模板 id' },
      toTemplateId: { type: 'string', description: '被描述方的角色模板 id' },
      description: { type: 'string', description: '第一人称的关系描述（如「小美是我的同桌，学习很好」）' },
    },
    ['fromTemplateId', 'toTemplateId', 'description'],
  ),
  validate: (input) => {
    const out = {
      fromTemplateId: reqStr(input, 'fromTemplateId'),
      toTemplateId: reqStr(input, 'toTemplateId'),
      description: reqStr(input, 'description'),
    }
    if (out.fromTemplateId === out.toTemplateId) throw new Error('不能设置指向自己的关系')
    assertTemplateExists(out.fromTemplateId, 'fromTemplateId')
    assertTemplateExists(out.toTemplateId, 'toTemplateId')
    return out
  },
  run: async (input) => {
    setRelationship(String(input.fromTemplateId), String(input.toTemplateId), String(input.description))
    return `已设置关系 ${input.fromTemplateId}→${input.toTemplateId}。`
  },
  summarize: () => '设置角色关系',
}

const deleteRelationshipTool: AgentToolDef = {
  name: 'delete_relationship',
  isWrite: true,
  schema: objSchema(
    'delete_relationship',
    '删除一条有向关系。删除双向关系需要调用两次（两个方向各一条）。',
    {
      fromTemplateId: { type: 'string', description: '视角方的角色模板 id' },
      toTemplateId: { type: 'string', description: '被描述方的角色模板 id' },
    },
    ['fromTemplateId', 'toTemplateId'],
  ),
  validate: (input) => ({
    fromTemplateId: reqStr(input, 'fromTemplateId'),
    toTemplateId: reqStr(input, 'toTemplateId'),
  }),
  run: async (input) => {
    const ok = deleteRelationship(String(input.fromTemplateId), String(input.toTemplateId))
    return ok
      ? `已删除关系 ${input.fromTemplateId}→${input.toTemplateId}。`
      : `未找到关系 ${input.fromTemplateId}→${input.toTemplateId}。`
  },
  summarize: () => '删除角色关系',
}

/** 工具表（Partial 不是必须的——本 Agent 只有一副工具面） */
export const AGENT_TOOLS: Record<string, AgentToolDef> = Object.fromEntries(
  [
    listCharacterTemplatesTool,
    upsertCharacterTemplateTool,
    deleteCharacterTemplateTool,
    listTopicTemplatesTool,
    upsertTopicTemplateTool,
    deleteTopicTemplateTool,
    listWorldviewTemplatesTool,
    upsertWorldviewTemplateTool,
    deleteWorldviewTemplateTool,
    listRelationshipsTool,
    setRelationshipTool,
    deleteRelationshipTool,
  ].map((t) => [t.name, t]),
)

/** 全部工具 schema（发给 LLM 用） */
export const AGENT_TOOL_SCHEMAS: AgentToolSchema[] = Object.values(AGENT_TOOLS).map((t) => t.schema)
