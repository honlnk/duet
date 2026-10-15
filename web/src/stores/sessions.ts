/**
 * 会话列表 Store —— 管理左侧侧栏的会话历史列表
 *
 * 与 useSessionStore（单个当前会话的核心状态机）解耦：
 *  - 这里只维护「摘要列表」（SessionSummary[]）的 CRUD；
 *  - currentId 跟踪路由当前指向的会话，用于列表项高亮。
 *
 * 数据来源：GET /api/sessions（listSessions）、DELETE /api/sessions/:id。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { listSessions, deleteSession } from '@/services/api'
import type { SessionSummary } from '@/types/api'

export const useSessionsStore = defineStore('sessions', () => {
  const summaries = ref<SessionSummary[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** 当前路由指向的会话 id（列表高亮用） */
  const currentId = ref<string | null>(null)

  /** 按更新时间倒序（后端已排序，这里兜底） */
  const sorted = computed(() =>
    [...summaries.value].sort((a, b) => b.updatedAt - a.updatedAt),
  )

  /** 拉取会话列表 */
  async function load() {
    loading.value = true
    error.value = null
    try {
      summaries.value = await listSessions()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  /** 重新拉取（流式结束/删除后刷新） */
  async function refresh() {
    try {
      summaries.value = await listSessions()
    } catch {
      /* 静默 */
    }
  }

  /** 删除会话并从列表移除 */
  async function remove(id: string) {
    await deleteSession(id)
    summaries.value = summaries.value.filter((s) => s.id !== id)
  }

  /** 新增一个摘要到列表头部（创建会话后即时插入，无需等待重拉） */
  function prepend(summary: SessionSummary) {
    const exists = summaries.value.some((s) => s.id === summary.id)
    if (!exists) summaries.value.unshift(summary)
  }

  /** 更新某条摘要的局部字段（流式过程中轮次/消息数变化） */
  function patch(id: string, patch: Partial<SessionSummary>) {
    const idx = summaries.value.findIndex((s) => s.id === id)
    if (idx >= 0) {
      summaries.value[idx] = { ...summaries.value[idx]!, ...patch }
    }
  }

  return {
    summaries,
    sorted,
    loading,
    error,
    currentId,
    load,
    refresh,
    remove,
    prepend,
    patch,
  }
})
