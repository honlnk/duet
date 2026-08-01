/**
 * 智能体模板 & 话题模板 Store
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
  removeTopicTemplate,
  type AgentTemplate,
  type TopicTemplate,
} from '@/services/templates'

export const useTemplateStore = defineStore('template', () => {
  const agents = ref<AgentTemplate[]>(loadAgentTemplates())
  const topics = ref<TopicTemplate[]>(loadTopicTemplates())

  /**
   * 跨组件信号：在设置页（智能体模板 tab）点「新建会话」后置 true，
   * App.vue 监听到后关闭设置、打开新建对话模态。
   */
  const pendingNewChat = ref(false)

  /** 重新从 localStorage 拉取（外部修改后同步） */
  function refresh() {
    agents.value = loadAgentTemplates()
    topics.value = loadTopicTemplates()
  }

  /** 新增智能体模板，返回新列表 */
  function addAgent(name: string, persona: string): AgentTemplate[] {
    agents.value = addAgentTemplate(name, persona)
    return agents.value
  }

  /** 更新智能体模板 */
  function updateAgent(
    id: string,
    patch: Partial<Pick<AgentTemplate, 'name' | 'persona'>>,
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

  /** 按 id 查找智能体模板 */
  function findAgent(id: string | undefined | null): AgentTemplate | undefined {
    if (!id) return undefined
    return agents.value.find((t) => t.id === id)
  }

  /** 请求打开新建对话（由设置页调用） */
  function requestNewChat() {
    pendingNewChat.value = true
  }

  return {
    agents,
    topics,
    pendingNewChat,
    refresh,
    addAgent,
    updateAgent,
    removeAgent,
    addTopic,
    removeTopic,
    findAgent,
    requestNewChat,
  }
})
