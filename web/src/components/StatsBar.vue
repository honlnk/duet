<script setup lang="ts">
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useDurationTracker } from '@/composables/useDurationTracker'
import StatusBadge from './StatusBadge.vue'

const session = useSessionStore()
const { status, round, maxRounds, stats, startedAt, durationSec } =
  storeToRefs(session)

const { display: durationDisplay, start, stop } = useDurationTracker()

// 开始/停止计时器随会话状态联动
watch(
  () => [startedAt.value, durationSec.value, status.value] as const,
  ([sa, ds, st]) => {
    if (sa && (st === 'running' || st === 'stopped' || st === 'finished')) {
      start(sa, ds)
    } else {
      stop()
    }
  },
  { immediate: true },
)

/** 轮次展示 */
const roundText = computed(() => {
  const max = maxRounds.value > 0 ? maxRounds.value : '∞'
  return `轮次 ${round.value} / ${max}`
})

/** 成本展示 */
const costText = computed(() => {
  return `${stats.value.totalTokens} token · $${stats.value.estCost.toFixed(4)}`
})
</script>

<template>
  <div class="flex items-center gap-4 text-xs">
    <StatusBadge :status="status" />
    <span class="text-text-dim">{{ roundText }}</span>
    <span class="text-text-dim">{{ durationDisplay }}</span>
    <span class="text-accent font-medium">{{ costText }}</span>
  </div>
</template>
