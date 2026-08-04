<script setup lang="ts">
/**
 * 话题选择器（从话题模板中选择，而非手填）。
 *
 * 交互与 AgentForm 的「搜索框 + 下拉 / 已选卡片」模式对齐：
 *  - 已选择：展示话题文本 + 「更换」按钮
 *  - 未选择：搜索框 + 下拉列表，输入时按关键字筛选，点击即选中
 *  - 空态（无话题模板）：提示去设置添加
 *
 * 绑定 form store 的 topic / topicTemplateId。
 */
import { computed, nextTick, ref } from 'vue'
import { useFormStore } from '@/stores/form'
import { useTemplateStore } from '@/stores/template'

const emit = defineEmits<{ 'open-settings': [] }>()

const form = useFormStore()
const template = useTemplateStore()

/** 当前是否已选择话题 */
const selected = computed(() => form.values.topicTemplateId !== '')

/* --------------------------- 搜索 + 下拉 --------------------------- */

const searchQuery = ref('')
const dropdownOpen = ref(false)
const searchInputEl = ref<HTMLInputElement | null>(null)

/** 按关键字筛选后的可选话题模板 */
const filteredTopics = computed(() => {
  const kw = searchQuery.value.trim().toLowerCase()
  const list = template.topics
  if (!kw) return list
  return list.filter((t) => t.content.toLowerCase().includes(kw))
})

/** 展开下拉（聚焦时触发） */
async function openDropdown() {
  dropdownOpen.value = true
  await nextTick()
  searchInputEl.value?.focus()
}

/** 收起下拉（延迟，允许点击选项先触发） */
function closeDropdown() {
  setTimeout(() => {
    dropdownOpen.value = false
  }, 150)
}

function pick(tid: string) {
  const t = template.topics.find((x) => x.id === tid)
  if (!t) return
  form.selectTopic(t.id, t.content)
  searchQuery.value = ''
  dropdownOpen.value = false
}

function change() {
  form.clearTopic()
  searchQuery.value = ''
  // 清除后自动展开下拉方便重选
  void openDropdown()
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label class="text-xs font-medium text-text-dim">话题</label>

    <!-- 已选择：展示话题卡片 -->
    <div
      v-if="selected"
      class="flex items-start justify-between gap-2 rounded-lg border border-border-subtle bg-bg-card p-3"
    >
      <p class="min-w-0 flex-1 text-sm leading-relaxed text-text-main">
        {{ form.values.topic }}
      </p>
      <button
        type="button"
        class="shrink-0 rounded-md border border-border-subtle px-2 py-1 text-xs text-text-dim hover:bg-bg-hover"
        @click="change"
      >
        更换
      </button>
    </div>

    <!-- 未选择：搜索框 + 下拉 -->
    <div v-else class="relative flex flex-col gap-1">
      <!-- 空态提示 -->
      <p
        v-if="template.topics.length === 0"
        class="flex flex-col gap-2 rounded-lg bg-bg-hover px-3 py-2 text-xs text-text-muted"
      >
        没有可选话题，请先在「设置」中添加。
        <button
          type="button"
          class="self-start rounded-md border border-border-subtle px-2 py-1 text-xs font-medium text-text-dim hover:bg-bg-hover"
          @click="emit('open-settings')"
        >
          去设置添加话题
        </button>
      </p>
      <template v-else>
        <!-- 搜索输入框 -->
        <input
          ref="searchInputEl"
          v-model="searchQuery"
          type="text"
          placeholder="搜索话题…"
          class="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-main outline-none focus:border-focus focus:ring-1 focus:ring-focus"
          @focus="openDropdown"
          @blur="closeDropdown"
        />
        <!-- 下拉列表 -->
        <div
          v-if="dropdownOpen"
          class="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border-subtle bg-white py-1 shadow-lg"
        >
          <button
            v-for="t in filteredTopics"
            :key="t.id"
            type="button"
            class="flex w-full items-start px-3 py-2 text-left transition-colors hover:bg-bg-hover"
            @mousedown.prevent="pick(t.id)"
          >
            <span class="line-clamp-2 text-sm text-text-main">{{ t.content }}</span>
          </button>
          <p
            v-if="filteredTopics.length === 0"
            class="px-3 py-2 text-xs text-text-muted"
          >
            没有匹配「{{ searchQuery }}」的话题
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
