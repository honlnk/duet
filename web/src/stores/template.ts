/**
 * 智能体模板 & 话题模板 & 世界观模板 Store
 *
 * 集中管理 localStorage 中的可复用模板，供「新建对话」选择智能体、
 * 以及「设置」页编辑模板时共享同一份数据源。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  loadAgentTemplates,
  addAgentTemplate,
  updateAgentTemplate,
  removeAgentTemplate,
  loadTopicTemplates,
  addTopicTemplate,
  updateTopicTemplate,
  removeTopicTemplate,
  loadWorldviewTemplates,
  addWorldviewTemplate,
  updateWorldviewTemplate,
  removeWorldviewTemplate,
  type AgentTemplate,
  type TopicTemplate,
  type WorldviewTemplate,
} from '@/services/templates'

export const useTemplateStore = defineStore('template', () => {
  const agents = ref<AgentTemplate[]>(loadAgentTemplates())
  const topics = ref<TopicTemplate[]>(loadTopicTemplates())
  const worldviews = ref<WorldviewTemplate[]>(loadWorldviewTemplates())

  /**
   * 跨组件信号：在设置页（智能体模板 tab）点「新建会话」后置 true，
   * App.vue 监听到后关闭设置、打开新建对话模态。
   */
  const pendingNewChat = ref(false)

  /** 重新从 localStorage 拉取（外部修改后同步） */
  function refresh() {
    agents.value = loadAgentTemplates()
    topics.value = loadTopicTemplates()
    worldviews.value = loadWorldviewTemplates()
  }

  /** 新增智能体模板，返回新列表 */
  function addAgent(
    name: string,
    description: string = '',
    personality: string = '',
  ): AgentTemplate[] {
    agents.value = addAgentTemplate(name, description, personality)
    return agents.value
  }

  /** 更新智能体模板 */
  function updateAgent(
    id: string,
    patch: Partial<Pick<AgentTemplate, 'name' | 'description' | 'personality'>>,
  ): AgentTemplate[] {
    agents.value = updateAgentTemplate(id, patch)
    return agents.value
  }

  /** 删除智能体模板 */
  function removeAgent(id: string): AgentTemplate[] {
    agents.value = removeAgentTemplate(id)
    return agents.value
  }

  /** 新增话题模板 */
  function addTopic(content: string): TopicTemplate[] {
    topics.value = addTopicTemplate(content)
    return topics.value
  }

  /** 删除话题模板 */
  function removeTopic(id: string): TopicTemplate[] {
    topics.value = removeTopicTemplate(id)
    return topics.value
  }

  /** 更新话题模板内容 */
  function updateTopic(id: string, content: string): TopicTemplate[] {
    topics.value = updateTopicTemplate(id, content)
    return topics.value
  }

  /** 新增世界观模板 */
  function addWorldview(
    name: string,
    scenario: string,
    globalPrompt?: string,
  ): WorldviewTemplate[] {
    worldviews.value = addWorldviewTemplate(name, scenario, globalPrompt)
    return worldviews.value
  }

  /** 删除世界观模板 */
  function removeWorldview(id: string): WorldviewTemplate[] {
    worldviews.value = removeWorldviewTemplate(id)
    return worldviews.value
  }

  /** 更新世界观模板 */
  function updateWorldview(
    id: string,
    patch: Partial<Pick<WorldviewTemplate, 'name' | 'scenario' | 'globalPrompt'>>,
  ): WorldviewTemplate[] {
    worldviews.value = updateWorldviewTemplate(id, patch)
    return worldviews.value
  }

  /** 按 id 查找智能体模板 */
  function findAgent(id: string | undefined | null): AgentTemplate | undefined {
    if (!id) return undefined
    return agents.value.find((t) => t.id === id)
  }

  /** 按 id 查找世界观模板 */
  function findWorldview(id: string | undefined | null): WorldviewTemplate | undefined {
    if (!id) return undefined
    return worldviews.value.find((t) => t.id === id)
  }

  /** 请求打开新建对话（由设置页调用） */
  function requestNewChat() {
    pendingNewChat.value = true
  }

  return {
    agents,
    topics,
    worldviews,
    pendingNewChat,
    refresh,
    addAgent,
    updateAgent,
    removeAgent,
    addTopic,
    updateTopic,
    removeTopic,
    addWorldview,
    updateWorldview,
    removeWorldview,
    findAgent,
    findWorldview,
    requestNewChat,
  }
})
