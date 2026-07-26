<script setup lang="ts">
import { computed } from 'vue'
import type { ViewMessage } from '@/stores/session'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ message: ViewMessage }>()

const session = useSessionStore()

const isA = computed(() => props.message.agentId === 'A')
const name = computed(() => session.agentName(props.message.agentId))

/** 气泡颜色与对齐 */
const wrapperClass = computed(() =>
  isA.value ? 'self-start items-start' : 'self-end items-end',
)
const accentClass = computed(() =>
  isA.value
    ? 'border-l-[3px] border-l-agent-a'
    : 'border-r-[3px] border-r-agent-b',
)
</script>

<template>
  <div class="flex w-full flex-col gap-1" :class="wrapperClass">
    <span
      class="px-2 text-xs font-medium"
      :class="isA ? 'text-agent-a' : 'text-agent-b'"
    >
      {{ name }}
    </span>
    <div
      class="max-w-[85%] rounded-xl bg-bg-card px-3 py-2 text-text-main whitespace-pre-wrap break-words md:max-w-[72%]"
      :class="[accentClass, message.truncated && 'opacity-60 border border-dashed border-border-subtle']"
    >
      <span>{{ message.content }}</span>
      <!-- 流式光标 -->
      <span
        v-if="message.streaming"
        class="inline-block w-[7px] ml-0.5 text-accent animate-blink"
        >▋</span
      >
      <span
        v-if="message.truncated"
        class="ml-2 text-xs text-warn"
        >[已截断]</span
      >
    </div>
  </div>
</template>
