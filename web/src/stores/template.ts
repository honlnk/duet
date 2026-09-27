/**
 * 角色模板 & 话题模板 & 世界观模板 Store
 *
 * 集中管理服务端资产库中的可复用模板，供「新建对话」选择角色、
 * 以及「设置」页编辑模板时共享同一份数据源。
 * v2：数据源从 localStorage 换为服务端 REST，所有变更方法变为 async，
 * 本地 ref 即时更新（单次往返），失败时回退刷新。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  loadCharacterTemplates,
  addCharacterTemplate,
  updateCharacterTemplate,
  removeCharacterTemplate,
  loadTopicTemplates,
  addTopicTemplate,
  updateTopicTemplate,
  removeTopicTemplate,
  loadWorldviewTemplates,
  addWorldviewTemplate,
  updateWorldviewTemplate,
  removeWorldviewTemplate,
  type CharacterTemplate,
  type TopicTemplate,
  type WorldviewTemplate,
} from '@/services/templates'

export const useTemplateStore = defineStore('template', () => {
  const characters = ref<CharacterTemplate[]>([])
  const topics = ref<TopicTemplate[]>([])
  const worldviews = ref<WorldviewTemplate[]>([])

  /**
   * 跨组件信号：在设置页（角色模板 tab）点「新建会话」后置 true，
   * App.vue 监听到后关闭设置、打开新建对话模态。
   */
  const pendingNewChat = ref(false)

  /** 重新从服务端拉取（外部修改后同步，如 Agent 助手改动资产） */
  async function refresh(): Promise<void> {
    const [c, t, w] = await Promise.all([
      loadCharacterTemplates(),
      loadTopicTemplates(),
      loadWorldviewTemplates(),
    ])
    characters.value = c
    topics.value = t
    worldviews.value = w
  }

  /** 新增角色模板 */
  async function addCharacter(
    name: string,
    description: string = '',
    personality: string = '',
  ): Promise<void> {
    try {
      const created = await addCharacterTemplate(name, description, personality)
      characters.value = [created, ...characters.value]
    } catch (e) {
      console.warn('[template] 新增角色模板失败', e)
      await refresh()
    }
  }

  /** 更新角色模板 */
  async function updateCharacter(
    id: string,
    patch: Partial<Pick<CharacterTemplate, 'name' | 'description' | 'personality'>>,
  ): Promise<void> {
    const existing = characters.value.find((t) => t.id === id)
    try {
      const updated = await updateCharacterTemplate(id, {
        // name 必填：patch 未提供时沿用现有值
        name: patch.name?.trim() || existing?.name || '',
        description: patch.description ?? existing?.description ?? '',
        personality: patch.personality ?? existing?.personality ?? '',
      })
      characters.value = characters.value.map((t) => (t.id === id ? updated : t))
    } catch (e) {
      console.warn('[template] 更新角色模板失败', e)
      await refresh()
    }
  }

  /** 删除角色模板 */
  async function removeCharacter(id: string): Promise<void> {
    try {
      await removeCharacterTemplate(id)
      characters.value = characters.value.filter((t) => t.id !== id)
    } catch (e) {
      console.warn('[template] 删除角色模板失败', e)
      await refresh()
    }
  }

  /** 新增话题模板 */
  async function addTopic(content: string): Promise<void> {
    try {
      const created = await addTopicTemplate(content)
      topics.value = [created, ...topics.value]
    } catch (e) {
      console.warn('[template] 新增话题模板失败', e)
      await refresh()
    }
  }

  /** 删除话题模板 */
  async function removeTopic(id: string): Promise<void> {
    try {
      await removeTopicTemplate(id)
      topics.value = topics.value.filter((t) => t.id !== id)
    } catch (e) {
      console.warn('[template] 删除话题模板失败', e)
      await refresh()
    }
  }

  /** 更新话题模板内容 */
  async function updateTopic(id: string, content: string): Promise<void> {
    try {
      const updated = await updateTopicTemplate(id, content)
      topics.value = topics.value.map((t) => (t.id === id ? updated : t))
    } catch (e) {
      console.warn('[template] 更新话题模板失败', e)
      await refresh()
    }
  }

  /** 新增世界观模板 */
  async function addWorldview(
    name: string,
    scenario: string,
  ): Promise<void> {
    try {
      const created = await addWorldviewTemplate(name, scenario)
      worldviews.value = [created, ...worldviews.value]
    } catch (e) {
      console.warn('[template] 新增世界观模板失败', e)
      await refresh()
    }
  }

  /** 删除世界观模板 */
  async function removeWorldview(id: string): Promise<void> {
    try {
      await removeWorldviewTemplate(id)
      worldviews.value = worldviews.value.filter((t) => t.id !== id)
    } catch (e) {
      console.warn('[template] 删除世界观模板失败', e)
      await refresh()
    }
  }

  /** 更新世界观模板 */
  async function updateWorldview(
    id: string,
    patch: Partial<Pick<WorldviewTemplate, 'name' | 'scenario'>>,
  ): Promise<void> {
    const existing = worldviews.value.find((t) => t.id === id)
    try {
      const updated = await updateWorldviewTemplate(id, {
        name: patch.name?.trim() || existing?.name || '',
        scenario: patch.scenario ?? existing?.scenario ?? '',
      })
      worldviews.value = worldviews.value.map((t) => (t.id === id ? updated : t))
    } catch (e) {
      console.warn('[template] 更新世界观模板失败', e)
      await refresh()
    }
  }

  /** 按 id 查找角色模板 */
  function findCharacter(id: string | undefined | null): CharacterTemplate | undefined {
    if (!id) return undefined
    return characters.value.find((t) => t.id === id)
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
    characters,
    topics,
    worldviews,
    pendingNewChat,
    refresh,
    addCharacter,
    updateCharacter,
    removeCharacter,
    addTopic,
    updateTopic,
    removeTopic,
    addWorldview,
    updateWorldview,
    removeWorldview,
    findCharacter,
    findWorldview,
    requestNewChat,
  }
})
