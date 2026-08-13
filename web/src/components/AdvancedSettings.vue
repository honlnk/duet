<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onMounted, ref } from 'vue'
import { useFormStore } from '@/stores/form'
import { useProviderStore } from '@/stores/provider'
import { fetchThinkingOptions } from '@/services/api'
import type { ThinkingOption } from '@/types/api'

const form = useFormStore()
const { values } = storeToRefs(form)
const { providers, defaultId } = storeToRefs(useProviderStore())

interface Field {
  key:
    | 'temperature'
    | 'maxRounds'
    | 'durationSec'
    | 'summaryEveryN'
    | 'keepRecent'
  label: string
  placeholder: string
  /** 输入模式：decimal 允许小数，numeric 仅整数 */
  inputmode?: 'decimal' | 'numeric'
  hint?: string
}

const fields: Field[] = [
  {
    key: 'temperature',
    label: '温度',
    placeholder: '0.7',
    inputmode: 'decimal',
  },
  {
    key: 'maxRounds',
    label: '对话轮数上限',
    placeholder: '留空 = 无限',
    inputmode: 'numeric',
    hint: '留空 = 无限（仍受全局熔断）',
  },
  {
    key: 'durationSec',
    label: '持续时间上限(秒)',
    placeholder: '留空 = 无限',
    inputmode: 'numeric',
  },
  {
    key: 'summaryEveryN',
    label: '每 N 轮触发摘要',
    placeholder: '10',
    inputmode: 'numeric',
  },
  {
    key: 'keepRecent',
    label: '压缩后保留最近消息数',
    placeholder: '8',
    inputmode: 'numeric',
  },
]

/** 选项标签：显示名称 + 模型 + 默认标记 */
function labelOf(id: string): string {
  const p = providers.value.find((x) => x.id === id)
  if (!p) return ''
  const star = id === defaultId.value ? ' ★' : ''
  return `${p.name}（${p.model}）${star}`
}

/** 智能体字母标签（A/B/C…） */
function agentLabel(idx: number): string {
  return String.fromCharCode(65 + idx)
}

/* ----------------------- 思考选项（动态获取） ----------------------- */
interface ThinkingState {
  options: ThinkingOption[]
  providerDefault?: string
  supported: boolean
  loading: boolean
  /** 已加载的 provider id，用于判断切换后是否需重载 */
  loadedFor: string
}

/** 每 agent 的思考选项状态（按 idx 索引） */
const thinkingStates = ref<Record<number, ThinkingState>>({})

/** 取 agent 实际生效的 provider id（空 = 默认） */
function effectiveProviderId(idx: number): string {
  return values.value.agents[idx]?.provider || defaultId.value
}

/** 拉取某 agent 当前 provider 的思考可选项 */
async function loadThinkingOptions(idx: number) {
  const pid = effectiveProviderId(idx)
  if (!pid) return
  if (thinkingStates.value[idx]?.loadedFor === pid) return
  thinkingStates.value[idx] = { options: [], supported: false, loading: true, loadedFor: pid }
  try {
    const resp = await fetchThinkingOptions(pid)
    thinkingStates.value[idx] = {
      options: resp.options,
      providerDefault: resp.providerDefault,
      supported: resp.supported,
      loading: false,
      loadedFor: pid,
    }
  } catch {
    thinkingStates.value[idx] = { options: [], supported: false, loading: false, loadedFor: pid }
  }
}

/** provider 切换：更新 provider、重置思考档位、重载思考选项 */
function onProviderChange(idx: number, e: Event) {
  const val = (e.target as HTMLSelectElement).value
  form.patchAgent(idx, { provider: val, thinking: '' })
  loadThinkingOptions(idx)
}

onMounted(() => {
  values.value.agents.forEach((_agent, idx) => loadThinkingOptions(idx))
})
</script>

<template>
  <details class="group rounded-lg border border-border-subtle bg-bg-card/50">
    <summary
      class="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-sm text-text-dim hover:text-text-main"
    >
      <span>高级设置</span>
      <span class="transition-transform group-open:rotate-90">▸</span>
    </summary>
    <div class="flex flex-col gap-3 px-3 pb-3 pt-1">
      <!-- 每个智能体的 Provider 选择（动态） -->
      <div
        v-for="(agent, idx) in values.agents"
        :key="idx"
        class="flex flex-col gap-1"
      >
        <label class="text-xs text-text-dim">智能体 {{ agentLabel(idx) }} 模型</label>
        <select
          :value="agent.provider"
          class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-focus focus:ring-1 focus:ring-focus"
          @change="onProviderChange(idx, $event)"
        >
          <option value="">默认（{{ labelOf(defaultId) }}）</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">
            {{ labelOf(p.id) }}
          </option>
        </select>
        <!-- 思考档位（动态获取该 provider 模型的可选项） -->
        <label class="mt-1 text-xs text-text-dim">智能体 {{ agentLabel(idx) }} 思考</label>
        <select
          v-if="thinkingStates[idx]?.supported"
          :value="agent.thinking"
          class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-focus focus:ring-1 focus:ring-focus"
          @change="form.patchAgent(idx, { thinking: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">
            默认（{{
              thinkingStates[idx]?.providerDefault
                ? 'Provider: ' + thinkingStates[idx].providerDefault
                : '不开启'
            }}）
          </option>
          <option v-for="o in thinkingStates[idx]?.options" :key="o.key" :value="o.key">
            {{ o.label }}
          </option>
        </select>
        <span
          v-else-if="thinkingStates[idx] && !thinkingStates[idx].loading"
          class="text-[10px] text-text-muted"
          >该模型不支持思考</span
        >
        <span
          v-else-if="thinkingStates[idx]?.loading"
          class="text-[10px] text-text-muted"
          >加载思考选项中…</span
        >
      </div>

      <!-- 数字字段（保持字符串值，用 inputmode 引导键盘） -->
      <div
        v-for="f in fields"
        :key="f.key"
        class="flex flex-col gap-1"
      >
        <label class="text-xs text-text-dim">{{ f.label }}</label>
        <input
          v-model="values[f.key]"
          type="text"
          :inputmode="f.inputmode ?? 'decimal'"
          :placeholder="f.placeholder"
          class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-focus focus:ring-1 focus:ring-focus"
        />
        <span v-if="f.hint" class="text-xs text-text-muted">{{ f.hint }}</span>
      </div>
    </div>
  </details>
</template>
