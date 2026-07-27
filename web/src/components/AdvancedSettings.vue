<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useFormStore } from '@/stores/form'

const form = useFormStore()
const { values } = storeToRefs(form)

/** 可选模型列表（与后端 defaultModel 对齐） */
const models = ['deepseek-v4-flash', 'deepseek-v4-pro']

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
      <!-- 模型下拉框 -->
      <div class="flex flex-col gap-1">
        <label class="text-xs text-text-dim">模型</label>
        <select
          v-model="values.model"
          class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        >
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
        </select>
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
          class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <span v-if="f.hint" class="text-xs text-text-muted">{{ f.hint }}</span>
      </div>
    </div>
  </details>
</template>
