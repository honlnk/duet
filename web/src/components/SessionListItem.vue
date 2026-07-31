<script setup lang="ts">
/**
 * 会话列表项（深色侧栏内）
 *
 * 展示：话题（截断）、智能体 A vs B、状态圆点、消息数、相对时间。
 * 当前会话高亮（bg-white/15）；hover 显示删除按钮。
 * 点击 → 路由跳转；删除 → 确认后调用 store.remove。
 */
import { computed, ref } from 'vue'
import type { SessionSummary, SessionStatus } from '@/types/api'

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

/** 话题截断展示 */
const topic = computed(() => {
  const t = props.summary.topic.trim()
  return t.length > 0 ? t : '（无话题）'
})

/** 智能体展示：A vs B */
const agentsText = computed(() => {
  const [a, b] = props.summary.agents
  if (a && b) return `${a} vs ${b}`
  return a || b || ''
})

/** 状态圆点颜色 */
const statusDotClass = computed(() => {
  const map: Record<SessionStatus, string> = {
    running: 'bg-green-400',
    finished: 'bg-gray-400',
    stopped: 'bg-amber-400',
    error: 'bg-red-400',
    idle: 'bg-gray-500',
  }
  return map[props.summary.status]
})

/** 相对时间 */
const timeAgo = computed(() => {
  const diff = Date.now() - props.summary.updatedAt
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return new Date(props.summary.updatedAt).toLocaleDateString()
})
</script>

<template>
  <button
    type="button"
    class="group relative w-full rounded-lg px-3 py-2.5 text-left transition-colors"
    :class="active ? 'bg-white/15 text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'"
    @click="emit('navigate', summary.id)"
  >
    <!-- 状态圆点 + 话题 -->
    <div class="flex items-center gap-2">
      <span class="inline-block h-2 w-2 shrink-0 rounded-full" :class="statusDotClass" />
      <span class="flex-1 truncate text-sm font-medium">{{ topic }}</span>
    </div>

    <!-- 智能体 -->
    <p v-if="agentsText" class="mt-0.5 truncate pl-4 text-xs text-gray-400">
      {{ agentsText }}
    </p>

    <!-- 元信息 -->
    <div class="mt-1 flex items-center gap-2 pl-4 text-[11px] text-gray-500">
      <span>{{ summary.messageCount }} 条</span>
      <span>·</span>
      <span>{{ timeAgo }}</span>
    </div>

    <!-- 删除按钮（hover 显示） -->
    <span
      v-if="!confirming"
      class="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-red-500/20 hover:text-red-300 group-hover:flex"
      role="button"
      tabindex="0"
      aria-label="删除会话"
      @click="onDeleteClick"
      @keydown.enter="onDeleteClick"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    </span>
    <!-- 删除确认态 -->
    <span
      v-else
      class="absolute right-2 top-2 flex h-6 items-center rounded-md bg-red-500/20 px-2 text-[11px] text-red-300"
      @click="onDeleteClick"
    >
      删除？
    </span>
  </button>
</template>
