/**
 * 表单 Store —— 设置区单一数据源
 *
 * v2：智能体从固定 A/B 改为动态数组（2~10 个，每个含 name/description/color/provider）。
 * 标量字段（temperature 等）仍以字符串存储，提交时再转换。
 */
import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import type { CreateSessionPayload, SessionConfig } from '@/types/api'
import { MAX_AGENTS, MIN_AGENTS } from '@/types/api'
import {
  defaultValues,
  makeAgent,
  normalizeValues,
  type AgentFormValues,
  type FormValues,
} from '@/services/storage'
import { loadRelationships, translateRelationshipsForSession } from '@/services/relationships'

export const useFormStore = defineStore('form', () => {
  const values = reactive<FormValues>(defaultValues())

  /** 更新第 idx 个智能体的部分字段（如颜色、provider） */
  function patchAgent(idx: number, patch: Partial<AgentFormValues>) {
    const a = values.agents[idx]
    if (a) Object.assign(a, patch)
  }

  /** 选择一个话题模板：写入话题文本，记录模板 id */
  function selectTopic(templateId: string, content: string) {
    values.topicTemplateId = templateId
    values.topic = content
  }

  /** 清空话题选择（回到未选占位） */
  function clearTopic() {
    values.topicTemplateId = ''
    values.topic = ''
  }

  /** 选择一个世界观模板：写入 scenario/globalPrompt，记录模板 id */
  function selectWorldview(templateId: string, scenario: string, globalPrompt?: string) {
    values.worldviewTemplateId = templateId
    values.scenario = scenario
    values.globalPrompt = globalPrompt ?? ''
  }

  /** 清空世界观选择 */
  function clearWorldview() {
    values.worldviewTemplateId = ''
    values.scenario = ''
    values.globalPrompt = ''
  }

  /**
   * 为第 idx 个智能体选择一个模板：把模板的 name/description/personality 填入，
   * 记录 templateId。颜色保留当前选择（用户可在下方单独调）。
   */
  function selectTemplate(
    idx: number,
    templateId: string,
    name: string,
    description?: string,
    personality?: string,
  ) {
    const a = values.agents[idx]
    if (!a) return
    a.templateId = templateId
    a.name = name
    a.description = description ?? ''
    a.personality = personality ?? ''
  }

  /** 清空第 idx 个智能体的模板选择（回到未选占位） */
  function clearTemplate(idx: number) {
    const a = values.agents[idx]
    if (!a) return
    a.templateId = ''
    a.name = ''
    a.description = ''
    a.personality = ''
  }

  /** 追加一个空智能体（不超过 MAX_AGENTS） */
  function addAgent() {
    if (values.agents.length >= MAX_AGENTS) return
    values.agents.push(makeAgent(values.agents.length))
  }

  /** 移除指定位置智能体（不少于 MIN_AGENTS） */
  function removeAgent(idx: number) {
    if (values.agents.length <= MIN_AGENTS) return
    values.agents.splice(idx, 1)
  }

  /** 用任意值对象覆盖部分字段（标量） */
  function setValues(patch: Partial<FormValues>) {
    Object.assign(values, patch)
  }

  /** 整体替换（加载预设/草稿时），强制归一化 */
  function replace(next: FormValues) {
    const normalized = normalizeValues(next)
    values.topic = normalized.topic
    values.topicTemplateId = normalized.topicTemplateId
    values.scenario = normalized.scenario
    values.globalPrompt = normalized.globalPrompt
    values.worldviewTemplateId = normalized.worldviewTemplateId
    values.model = normalized.model
    values.temperature = normalized.temperature
    values.maxRounds = normalized.maxRounds
    values.durationSec = normalized.durationSec
    values.summaryEveryN = normalized.summaryEveryN
    values.keepRecent = normalized.keepRecent
    values.agents.splice(0, values.agents.length, ...normalized.agents)
    values.relationships = normalized.relationships
  }

  /** 清空为默认值 */
  function reset() {
    const def = defaultValues()
    values.topic = def.topic
    values.topicTemplateId = def.topicTemplateId
    values.scenario = def.scenario
    values.globalPrompt = def.globalPrompt
    values.worldviewTemplateId = def.worldviewTemplateId
    values.model = def.model
    values.temperature = def.temperature
    values.maxRounds = def.maxRounds
    values.durationSec = def.durationSec
    values.summaryEveryN = def.summaryEveryN
    values.keepRecent = def.keepRecent
    values.agents.splice(0, values.agents.length, ...def.agents)
    values.relationships = {}
  }

  /** 提取数字字段（空串/非法 → 0 = 无限） */
  function num(key: keyof FormValues): number {
    const v = values[key]
    const s = typeof v === 'string' ? v : String(v ?? '')
    if (s.trim() === '') return 0
    const n = Number.parseFloat(s)
    return Number.isFinite(n) ? n : 0
  }

  /** 转为后端 POST 请求体 */
  const payload = computed<CreateSessionPayload>(() => {
    // A/B/C 走专用字段，D~J 走 agentProviders 映射
    const providerA = values.agents[0]?.provider || undefined
    const providerB = values.agents[1]?.provider || undefined
    const providerC = values.agents[2]?.provider || undefined
    const agentProviders: Record<string, string> = {}
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const
    for (let i = 3; i < values.agents.length; i++) {
      const p = values.agents[i]?.provider
      if (p) agentProviders[ids[i]!] = p
    }
    const scenario = values.scenario.trim() || undefined
    const globalPrompt = values.globalPrompt.trim() || undefined
    return {
      topic: values.topic.trim(),
      agents: values.agents.map((a, i) => ({
        name: a.name.trim() || `智能体 ${i + 1}`,
        description: a.description.trim() || undefined,
        personality: a.personality.trim() || undefined,
        color: a.color,
      })),
      config: {
        model: values.model,
        temperature: num('temperature') || 0.7,
        maxRounds: num('maxRounds'),
        durationSec: num('durationSec'),
        summaryEveryN: num('summaryEveryN') || 10,
        keepRecent: num('keepRecent') || 8,
        providerA,
        providerB,
        providerC,
        agentProviders: Object.keys(agentProviders).length > 0 ? agentProviders : undefined,
        scenario,
        globalPrompt,
      } satisfies SessionConfig,
      // 从全局关系图自动注入：把基于 templateId 的关系翻译为会话内 A/B/C 关系
      relationships: (() => {
        // 构建 templateId → 会话 AgentId 映射
        const idMap: Record<string, string> = {}
        const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const
        values.agents.forEach((a, i) => {
          if (a.templateId && ids[i]) idMap[a.templateId] = ids[i]!
        })
        const globalRels = loadRelationships()
        const sessionRels = translateRelationshipsForSession(globalRels, idMap)
        return Object.keys(sessionRels).length > 0 ? sessionRels : undefined
      })(),
    }
  })

  /** 话题是否非空（校验用） */
  const hasTopic = computed(() => values.topic.trim().length > 0)

  /** 所有智能体是否都已选择模板（校验用） */
  const allAgentsSelected = computed(() =>
    values.agents.every((a) => a.templateId !== '' && a.name.trim() !== ''),
  )

  /** 是否可提交：话题非空且所有智能体都已选择 */
  const canSubmit = computed(() => hasTopic.value && allAgentsSelected.value)

  return {
    values,
    patchAgent,
    selectTopic,
    clearTopic,
    selectWorldview,
    clearWorldview,
    selectTemplate,
    clearTemplate,
    addAgent,
    removeAgent,
    setValues,
    replace,
    reset,
    num,
    payload,
    hasTopic,
    allAgentsSelected,
    canSubmit,
  }
})
