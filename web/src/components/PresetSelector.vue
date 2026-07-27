<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useDraftStore } from '@/stores/draft'
import { useFormStore } from '@/stores/form'
import { labelOf } from '@/services/storage'

const draft = useDraftStore()
const form = useFormStore()
const { history } = storeToRefs(draft)

const selectedId = ref('')

const options = computed(() => history.value)

function loadSelected() {
  const item = history.value.find((h) => h.id === selectedId.value)
  if (item) {
    form.replace(item.values)
  }
}

function clearDraft() {
  form.reset()
  draft.clearDraft()
  selectedId.value = ''
}

function clearHistory() {
  draft.clearHistory()
  selectedId.value = ''
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex gap-1.5">
      <select
        v-model="selectedId"
        class="min-w-0 flex-1 truncate rounded-md border border-border-subtle bg-bg-card px-2 py-1.5 text-sm text-text-main outline-none focus:border-accent"
      >
        <option value="" disabled>选择历史预设…</option>
        <option v-for="item in options" :key="item.id" :value="item.id">
          {{ labelOf(item.values) }}
        </option>
      </select>
      <button
        type="button"
        :disabled="!selectedId"
        class="shrink-0 rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-xs text-text-dim hover:bg-bg-hover disabled:opacity-40"
        @click="loadSelected"
      >
        加载
      </button>
    </div>
    <div class="flex justify-between text-xs">
      <button
        type="button"
        class="text-text-muted hover:text-text-dim"
        @click="clearDraft"
      >
        清除草稿
      </button>
      <button
        type="button"
        class="text-text-muted hover:text-danger"
        :disabled="options.length === 0"
        @click="clearHistory"
      >
        清空历史
      </button>
    </div>
  </div>
</template>
