/**
 * 表单 Store —— 设置区单一数据源
 *
 * 消除旧版 FIELD_KEYS（storage.js）与 fieldEls（ui.js）的双份维护。
 * 所有字段以字符串形式存储（与 <input> 一致），提交时再转换。
 */
import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import type { CreateSessionPayload, SessionConfig } from '@/types/api'
import type { FormValues } from '@/services/storage'

/** 默认表单值（空字符串代表无限/使用默认） */
function defaultValues(): FormValues {
  return {
    topic: '',
    agentAName: '',
    agentAPersona: '',
    agentBName: '',
    agentBPersona: '',
    model: 'deepseek-v4-flash',
    temperature: '0.7',
    maxRounds: '',
    durationSec: '',
    summaryEveryN: '10',
    keepRecent: '8',
  }
}

export const useFormStore = defineStore('form', () => {
  const values = reactive<FormValues>(defaultValues())

  /** 用任意值对象覆盖部分字段 */
  function setValues(patch: Partial<FormValues>) {
    Object.assign(values, patch)
  }

  /** 整体替换（加载预设/草稿时），强制归一化为字符串 */
  function replace(next: FormValues) {
    const merged = { ...defaultValues(), ...next }
    // 确保所有字段都是字符串（历史草稿可能残留数字类型）
    for (const k of Object.keys(merged) as (keyof FormValues)[]) {
      const v = merged[k]
      merged[k] = v == null ? '' : String(v)
    }
    Object.assign(values, merged)
  }

  /** 清空为默认值 */
  function reset() {
    Object.assign(values, defaultValues())
  }

  /** 提取数字字段（空串/非法 → 0 = 无限） */
  function num(key: keyof FormValues): number {
    const v = values[key]
    // 统一转字符串再解析，兼容历史草稿中残留的数字类型
    const s = typeof v === 'string' ? v : String(v ?? '')
    if (s.trim() === '') return 0
    const n = Number.parseFloat(s)
    return Number.isFinite(n) ? n : 0
  }

  /** 转为后端 POST 请求体 */
  const payload = computed<CreateSessionPayload>(() => ({
    topic: values.topic.trim(),
    agents: [
      {
        name: values.agentAName.trim() || '智能体 A',
        persona: values.agentAPersona.trim(),
      },
      {
        name: values.agentBName.trim() || '智能体 B',
        persona: values.agentBPersona.trim(),
      },
    ],
    config: {
      model: values.model,
      temperature: num('temperature') || 0.7,
      maxRounds: num('maxRounds'),
      durationSec: num('durationSec'),
      summaryEveryN: num('summaryEveryN') || 10,
      keepRecent: num('keepRecent') || 8,
    } satisfies SessionConfig,
  }))

  /** 话题是否非空（校验用） */
  const hasTopic = computed(() => values.topic.trim().length > 0)

  return { values, setValues, replace, reset, payload, hasTopic }
})
