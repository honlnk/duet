/**
 * Provider Store —— 多套模型连接配置
 *
 * 启动时从 GET /api/providers 拉取列表。
 * CRUD 操作后自动刷新本地缓存。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
} from '@/services/api'
import type { ProviderFormData, ProviderListItem } from '@/types/api'

export const useProviderStore = defineStore('provider', () => {
  const providers = ref<ProviderListItem[]>([])
  const defaultId = ref<string>('')
  const loaded = ref(false)

  /** 拉取列表 + 默认 id */
  async function load() {
    try {
      const data = await listProviders()
      providers.value = data.providers
      defaultId.value = data.defaultId
      loaded.value = true
    } catch (e) {
      console.error('[provider] 拉取失败', e)
    }
  }

  /** 把后端返回的完整列表响应同步到本地 */
  function sync(data: { providers: ProviderListItem[]; defaultId: string }) {
    providers.value = data.providers
    defaultId.value = data.defaultId
  }

  async function create(data: ProviderFormData) {
    sync(await createProvider(data))
  }

  async function update(id: string, data: Partial<ProviderFormData>) {
    sync(await updateProvider(id, data))
  }

  async function remove(id: string) {
    sync(await deleteProvider(id))
  }

  async function setDefault(id: string) {
    sync(await setDefaultProvider(id))
  }

  /** 按 id 查找列表项 */
  function find(id: string | undefined | null): ProviderListItem | undefined {
    if (!id) return undefined
    return providers.value.find((p) => p.id === id)
  }

  return {
    providers,
    defaultId,
    loaded,
    load,
    create,
    update,
    remove,
    setDefault,
    find,
  }
})
