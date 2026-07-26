/**
 * 配置 Store —— 全局熔断限制与成本单价
 *
 * 启动时从 GET /api/config/limits 拉取，用于填充高级设置默认值与上限提示。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getLimits } from '@/services/api'
import type { ConfigLimits } from '@/types/api'

export const useConfigStore = defineStore('config', () => {
  const limits = ref<ConfigLimits | null>(null)
  const loaded = ref(false)

  async function load() {
    try {
      limits.value = await getLimits()
      loaded.value = true
    } catch (e) {
      console.error('[config] 拉取限制失败', e)
    }
  }

  return { limits, loaded, load }
})
