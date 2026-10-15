<script setup lang="ts">
/**
 * 继续对话设置弹窗
 *
 * 暂停/报错停止后，用户可在此设置新的轮数上限或持续时间，
 * 不填则保持无限（maxRounds=0 / durationSec=0）。
 * 确认后上抛 resume 事件，由 SessionView 发 WS start。
 */
import { ref } from 'vue'

const emit = defineEmits<{
  close: []
  resume: [params: { maxRounds?: number; durationSec?: number }]
}>()

const maxRoundsInput = ref('')
const durationInput = ref('')
const durationUnit = ref<'minutes' | 'hours'>('minutes')

function handleConfirm() {
  const params: { maxRounds?: number; durationSec?: number } = {}

  const rounds = parseInt(maxRoundsInput.value, 10)
  if (Number.isFinite(rounds) && rounds > 0) {
    params.maxRounds = rounds
  }

  const dur = parseInt(durationInput.value, 10)
  if (Number.isFinite(dur) && dur > 0) {
    params.durationSec = durationUnit.value === 'hours' ? dur * 3600 : dur * 60
  }

  emit('resume', params)
}

// 遮罩点击关闭（防误触）
let mouseDownOnOverlay = false
function onOverlayMouseDown(e: MouseEvent) {
  mouseDownOnOverlay = e.target === e.currentTarget
}
function onOverlayClick(e: MouseEvent) {
  if (mouseDownOnOverlay && e.target === e.currentTarget) emit('close')
  mouseDownOnOverlay = false
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    @mousedown="onOverlayMouseDown"
    @click="onOverlayClick"
  >
    <div class="w-full max-w-sm rounded-xl bg-white shadow-xl">
      <!-- 头部 -->
      <div class="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
        <h2 class="text-base font-semibold text-text-main">继续对话</h2>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-main"
          aria-label="关闭"
          @click="emit('close')"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- 表单 -->
      <div class="flex flex-col gap-4 px-5 py-5">
        <!-- 轮数上限 -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-text-main">轮数上限</label>
          <input
            v-model="maxRoundsInput"
            type="number"
            min="1"
            placeholder="不填 = 无限"
            class="w-full rounded-lg border border-border-subtle px-3 py-2 text-sm text-text-main outline-none focus:border-focus"
          />
        </div>

        <!-- 持续时间 -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-text-main">持续时间</label>
          <div class="flex gap-2">
            <input
              v-model="durationInput"
              type="number"
              min="1"
              placeholder="不填 = 无限"
              class="flex-1 rounded-lg border border-border-subtle px-3 py-2 text-sm text-text-main outline-none focus:border-focus"
            />
            <select
              v-model="durationUnit"
              class="w-24 rounded-lg border border-border-subtle bg-white px-2 py-2 text-sm text-text-main outline-none focus:border-focus"
            >
              <option value="minutes">分钟</option>
              <option value="hours">小时</option>
            </select>
          </div>
        </div>

        <p class="text-xs text-text-muted">不填的项将保持无限（不设上限）。</p>
      </div>

      <!-- footer -->
      <div class="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
        <button
          type="button"
          class="rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-dim hover:bg-bg-hover"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="button"
          class="rounded-lg bg-focus px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
          @click="handleConfirm"
        >
          开始对话
        </button>
      </div>
    </div>
  </div>
</template>
