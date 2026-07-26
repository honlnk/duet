/**
 * 草稿 & 历史预设 Store
 *
 * 草稿：防抖（400ms）保存当前表单值到 localStorage，刷新后恢复。
 * 历史：每次「开始对话」时保存一份预设，按签名去重，上限 20。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  FIELD_KEYS,
  addHistory,
  clearDraft as clearDraftStorage,
  clearHistory as clearHistoryStorage,
  loadDraft,
  loadHistory,
  saveDraft,
  type FormValues,
  type HistoryItem,
} from '@/services/storage'

const DEBOUNCE_MS = 400

export const useDraftStore = defineStore('draft', () => {
  const history = ref<HistoryItem[]>(loadHistory())
  const draftRestored = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  /** 读取草稿，若无则返回 null。同时标记已恢复。 */
  function readDraft(): FormValues | null {
    const d = loadDraft()
    draftRestored.value = true
    return d
  }

  /** 防抖保存草稿（表单 input/change 时调用） */
  function scheduleSave(values: FormValues): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      saveDraft(values)
    }, DEBOUNCE_MS)
  }

  /** 立即清空草稿 */
  function clearDraft(): void {
    if (timer) clearTimeout(timer)
    clearDraftStorage()
  }

  /** 保存为历史预设（开始对话时调用） */
  function saveToHistory(values: FormValues): void {
    history.value = addHistory(values)
  }

  /** 清空所有历史 */
  function clearHistory(): void {
    clearHistoryStorage()
    history.value = []
  }

  return {
    FIELD_KEYS,
    history,
    draftRestored,
    readDraft,
    scheduleSave,
    clearDraft,
    saveToHistory,
    clearHistory,
  }
})
