<script setup lang="ts">
/**
 * NumberStepper —— 带自适应步长的数字输入框
 *
 * - 保留手动键盘输入能力（直接打字）
 * - 上下按钮使用自适应步长：连续快速点击自动升级档位
 * - step 通过 useAdaptiveStep 管理，base 由调用方指定
 */
import { useAdaptiveStep } from '@/composables/useAdaptiveStep'

const props = withDefaults(
  defineProps<{
    modelValue: number
    /** 基础步长（默认 0.01，缓存命中等小数字可用 0.001） */
    base?: number
    min?: number
  }>(),
  { base: 0.01, min: 0 },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const { step, onStep } = useAdaptiveStep(props.base)

/** 点击 + 按钮 */
function inc() {
  emit('update:modelValue', onStep(props.modelValue, 1))
}
/** 点击 − 按钮 */
function dec() {
  emit('update:modelValue', onStep(props.modelValue, -1))
}

/** 手动输入时直接透传（转 number，非法则 0） */
function onInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  emit('update:modelValue', Number.isFinite(v) ? v : 0)
}
</script>

<template>
  <div class="relative flex items-center">
    <input
      :value="modelValue"
      type="number"
      :step="step"
      :min="min"
      inputmode="decimal"
      class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 pr-7 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      @input="onInput"
    />
    <!-- 自定义上下按钮（右侧竖排，替代原生按钮） -->
    <div class="absolute right-0.5 flex flex-col">
      <button
        type="button"
        class="flex h-3.5 w-5 items-center justify-center text-text-muted hover:text-accent"
        tabindex="-1"
        aria-label="增加"
        @click="inc"
      >
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M5 2v6M2 5h6" />
        </svg>
      </button>
      <button
        type="button"
        class="flex h-3.5 w-5 items-center justify-center text-text-muted hover:text-accent"
        tabindex="-1"
        aria-label="减少"
        @click="dec"
      >
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M2 5h6" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 隐藏浏览器原生的上下箭头（已用自定义按钮替代） */
input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}
</style>
