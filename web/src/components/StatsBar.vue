<script setup lang="ts">
import { computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useDurationTracker } from '@/composables/useDurationTracker'
import StatusBadge from './StatusBadge.vue'

const session = useSessionStore()
const { status, round, maxRounds, stats, startedAt, stoppedAt, durationSec } =
  storeToRefs(session)

const { display: durationDisplay, start, stop } = useDurationTracker()

// 开始/停止计时器随会话状态联动。
// 仅 running 态跳动；stopped/finished 为终态，冻结在 stoppedAt 不再增长。
watch(
  () => [startedAt.value, durationSec.value, status.value] as const,
  ([sa, ds, st]) => {
    if (sa && st === 'running') {
      start(sa, ds)
    } else if (sa && (st === 'stopped' || st === 'finished')) {
      stop(stoppedAt.value ?? undefined)
    } else {
      stop()
    }
  },
  { immediate: true },
)

/**
 * 是否显示轮次：次数模式（maxRounds>0）或无限模式（两者皆 0）。
 * 纯时间模式不显示轮次。
 */
const showRound = computed(
  () => maxRounds.value > 0 || durationSec.value === 0,
)

/**
 * 是否显示时间：时间模式（durationSec>0）或无限模式（两者皆 0）。
 * 纯次数模式不显示时间（用户已用轮次衡量进度，无需多余计时）。
 */
const showDuration = computed(
  () => durationSec.value > 0 || maxRounds.value === 0,
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
  <div class="flex items-center gap-2 text-xs md:gap-4">
    <StatusBadge :status="status" />
    <span v-if="showRound" class="hidden text-text-dim sm:inline">{{ roundText }}</span>
    <span v-if="showDuration" class="text-text-dim">{{ durationDisplay }}</span>
    <span class="hidden text-accent font-medium md:inline">{{ costText }}</span>
  </div>
</template>
