<script setup lang="ts">
import { computed } from 'vue'
import { useFormStore } from '@/stores/form'
import type { AgentId } from '@/types/api'

const props = defineProps<{ agentId: AgentId }>()

const form = useFormStore()

const isA = computed(() => props.agentId === 'A')

const nameKey = computed(() => (isA.value ? 'agentAName' : 'agentBName'))
const personaKey = computed(
  () => (isA.value ? 'agentAPersona' : 'agentBPersona'),
)

const accentText = computed(() => (isA.value ? 'text-agent-a' : 'text-agent-b'))
const accentBorder = computed(() =>
  isA.value ? 'border-agent-a' : 'border-agent-b',
)
const label = computed(() => `智能体 ${props.agentId}`)
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <span class="h-2 w-2 rounded-full" :class="accentBorder" />
      <span class="text-xs font-medium" :class="accentText">{{ label }}</span>
    </div>
    <input
      v-model="form.values[nameKey]"
      type="text"
      :placeholder="`${label}名称`"
      class="w-full rounded-lg border border-border-subtle bg-bg-card px-3 py-2 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
    />
    <textarea
      v-model="form.values[personaKey]"
      :placeholder="`${label}身份设定（你是谁、你的立场是什么…）`"
      rows="3"
      class="w-full resize-y rounded-lg border border-border-subtle bg-bg-card px-3 py-2 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
    />
  </div>
</template>
