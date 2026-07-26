<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'

const emit = defineEmits<{
  start: []
  stop: []
  reset: []
}>()

const session = useSessionStore()
const { status, session: currentSession } = storeToRefs(session)

/** 按钮禁用矩阵 */
const canStart = computed(() => status.value !== 'running')
const canStop = computed(() => status.value === 'running')
const canReset = computed(() => !!currentSession.value)
</script>

<template>
  <div class="flex gap-2">
    <button
      type="button"
      :disabled="!canStart"
      class="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
      @click="emit('start')"
    >
      开始对话
    </button>
    <button
      type="button"
      :disabled="!canStop"
      class="rounded-lg border border-danger px-4 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-40"
      @click="emit('stop')"
    >
      停止
    </button>
    <button
      type="button"
      :disabled="!canReset"
      class="rounded-lg border border-border-subtle bg-bg-card px-4 py-2 text-sm text-text-dim hover:bg-bg-hover disabled:opacity-40"
      @click="emit('reset')"
    >
      重置
    </button>
  </div>
</template>
