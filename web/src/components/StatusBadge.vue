<script setup lang="ts">
import { computed } from 'vue'
import type { SessionStatus } from '@/types/api'

const props = defineProps<{ status: SessionStatus }>()

const labels: Record<SessionStatus, string> = {
  idle: '待机',
  running: '对话中',
  stopped: '已停止',
  finished: '已完成',
  error: '错误',
}

/** 状态对应的主色（Tailwind 类名） */
const colorClass = computed(() => {
  switch (props.status) {
    case 'running':
      return 'bg-ok/15 text-ok'
    case 'stopped':
    case 'finished':
      return 'bg-warn/15 text-warn'
    case 'error':
      return 'bg-danger/15 text-danger'
    default:
      return 'bg-text-muted/20 text-text-dim'
  }
})

const label = computed(() => labels[props.status])
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
    :class="colorClass"
  >
    <span
      v-if="status === 'running'"
      class="inline-block h-1.5 w-1.5 rounded-full bg-ok animate-pulse"
    />
    {{ label }}
  </span>
</template>
