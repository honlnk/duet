<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useFormStore } from '@/stores/form'
import AgentForm from './AgentForm.vue'
import AdvancedSettings from './AdvancedSettings.vue'
import PresetSelector from './PresetSelector.vue'
import ActionButtonBar from './ActionButtonBar.vue'

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{
  'update:collapsed': [value: boolean]
  start: []
  stop: []
  reset: []
}>()

const form = useFormStore()
const { values } = storeToRefs(form)

function toggle() {
  emit('update:collapsed', !props.collapsed)
}
</script>

<template>
  <aside
    class="flex flex-col gap-3 overflow-y-auto border-r border-border-subtle bg-bg-soft p-4 transition-all duration-200"
    :class="collapsed ? 'w-0 overflow-hidden p-0' : 'w-80'"
  >
    <!-- 话题 -->
    <div class="flex flex-col gap-1.5">
      <label class="text-xs font-medium text-text-dim">话题</label>
      <textarea
        v-model="values.topic"
        rows="3"
        placeholder="想让两个 AI 讨论什么？"
        class="w-full resize-y rounded-lg border border-border-subtle bg-bg-card px-3 py-2 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      />
    </div>

    <!-- 智能体 A / B -->
    <AgentForm agent-id="A" />
    <AgentForm agent-id="B" />

    <!-- 高级设置 -->
    <AdvancedSettings />

    <!-- 历史预设 -->
    <PresetSelector />

    <!-- 操作按钮 -->
    <ActionButtonBar
      @start="emit('start')"
      @stop="emit('stop')"
      @reset="emit('reset')"
    />
  </aside>
</template>
