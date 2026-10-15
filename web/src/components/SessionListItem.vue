<script setup lang="ts">
/**
 * 会话列表项（深色侧栏内）
 *
 * 极简风格（参照 gpt-image-studio ConversationSidebar）：
 * 仅展示话题标题（truncate），hover 时右侧浮现「删除」文字按钮。
 * 当前会话高亮（bg-white/10）；空话题回退「（无话题）」。
 * 点击 → 路由跳转；删除 → 二次确认。
 */
import { ref } from 'vue'
import type { SessionSummary } from '@/types/api'

const props = defineProps<{
  summary: SessionSummary
  active: boolean
}>()

const emit = defineEmits<{
  navigate: [id: string]
  remove: [id: string]
}>()

/** 删除确认：首次点击显示确认态，再次点击才真正删除 */
const confirming = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null

function onDeleteClick(e?: MouseEvent | KeyboardEvent) {
  e?.stopPropagation()
  if (confirming.value) {
    clearTimeout(confirmTimer!)
    confirming.value = false
    emit('remove', props.summary.id)
  } else {
    confirming.value = true
    // 3 秒未二次确认则恢复
    confirmTimer = setTimeout(() => (confirming.value = false), 3000)
  }
}
</script>

<template>
  <div
    :class="[
      'group mb-0.5 flex items-center gap-1 rounded-lg pr-1 transition-colors',
      active
        ? 'bg-white/10 text-white'
        : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
    ]"
  >
    <!-- 标题（点击跳转） -->
    <button
      type="button"
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm"
      @click="emit('navigate', summary.id)"
    >
      <!-- 进行中：旋转加载图标 -->
      <svg
        v-if="summary.status === 'running'"
        class="h-3.5 w-3.5 shrink-0 animate-spin text-blue-400"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
      <span class="truncate">{{ summary.topic.trim() || '（无话题）' }}</span>
    </button>

    <!-- 删除按钮（hover 显示，二次确认） -->
    <button
      v-if="!confirming"
      type="button"
      class="hidden shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-white/10 hover:text-red-300 group-hover:block focus:block"
      aria-label="删除会话"
      title="删除会话"
      @click.stop="onDeleteClick"
    >
      删除
    </button>
    <button
      v-else
      type="button"
      class="shrink-0 rounded-md bg-red-500/20 px-2 py-1 text-xs text-red-300"
      @click.stop="onDeleteClick"
    >
      确认？
    </button>
  </div>
</template>
