<script setup lang="ts">
import { computed } from 'vue'
import type { EventLogItem } from '@/stores/session'

const props = defineProps<{ items: EventLogItem[] }>()

const visible = computed(() => props.items.length > 0)
</script>

<template>
  <div
    v-if="visible"
    class="border-t border-border-subtle bg-bg-soft/50 px-4 py-2 max-h-[120px] overflow-y-auto"
  >
    <div
      v-for="item in items"
      :key="item.id"
      class="flex items-start gap-2 py-0.5 text-xs border-l-2 pl-2"
      :class="{
        'border-accent text-text-dim': item.type === 'summary',
        'border-danger text-danger': item.type === 'error',
        'border-border-subtle text-text-muted': item.type === 'info',
      }"
    >
      {{ item.text }}
    </div>
  </div>
</template>
