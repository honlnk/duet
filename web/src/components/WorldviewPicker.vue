<script setup lang="ts">
/**
 * 世界观选择器（从世界观模板中选择场景设定 + 导演指令）。
 *
 * 交互与 TopicPicker 的「搜索框 + 下拉 / 已选卡片」模式对齐：
 *  - 已选择：展示模板名 + scenario 摘要 + 「更换」/「移除」
 *  - 未选择：搜索框 + 下拉列表，输入时按关键字筛选，点击即选中
 *  - 空态（无世界观模板）：提示去设置添加
 *
 * 绑定 form store 的 scenario / globalPrompt / worldviewTemplateId。
 */
import { computed, nextTick, ref } from 'vue'
import { useFormStore } from '@/stores/form'
import { useTemplateStore } from '@/stores/template'

const emit = defineEmits<{ 'open-settings': [] }>()

const form = useFormStore()
const template = useTemplateStore()

/** 当前是否已选择世界观 */
const selected = computed(() => form.values.worldviewTemplateId !== '')

/* --------------------------- 搜索 + 下拉 --------------------------- */

const searchQuery = ref('')
const dropdownOpen = ref(false)
const searchInputEl = ref<HTMLInputElement | null>(null)

/** 按关键字筛选后的可选世界观模板 */
const filteredWorldviews = computed(() => {
  const kw = searchQuery.value.trim().toLowerCase()
  const list = template.worldviews
  if (!kw) return list
  return list.filter(
    (w) =>
      w.name.toLowerCase().includes(kw) ||
      w.scenario.toLowerCase().includes(kw) ||
      (w.globalPrompt?.toLowerCase().includes(kw) ?? false),
  )
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
  const w = template.worldviews.find((x) => x.id === tid)
  if (!w) return
  form.selectWorldview(w.id, w.scenario, w.globalPrompt)
  searchQuery.value = ''
  dropdownOpen.value = false
}

function change() {
  form.clearWorldview()
  searchQuery.value = ''
  // 清除后自动展开下拉方便重选
  void openDropdown()
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label class="text-xs font-medium text-text-dim">世界观（可选）</label>

    <!-- 已选择：展示世界观卡片 -->
    <div
      v-if="selected"
      class="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-bg-card p-3"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-text-main">
            {{ template.findWorldview(form.values.worldviewTemplateId)?.name ?? '世界观' }}
          </p>
          <p v-if="form.values.scenario" class="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-dim">
            {{ form.values.scenario }}
          </p>
          <p v-if="form.values.globalPrompt" class="mt-0.5 line-clamp-1 text-xs text-text-muted">
            导演：{{ form.values.globalPrompt }}
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md border border-border-subtle px-2 py-1 text-xs text-text-dim hover:bg-bg-hover"
          @click="change"
        >
          更换
        </button>
      </div>
    </div>

    <!-- 未选择：搜索框 + 下拉 -->
    <div v-else class="relative flex flex-col gap-1">
      <!-- 空态提示 -->
      <p
        v-if="template.worldviews.length === 0"
        class="flex flex-col gap-2 rounded-lg bg-bg-hover px-3 py-2 text-xs text-text-muted"
      >
        没有可选世界观模板，请先在「设置」中添加。
        <button
          type="button"
          class="self-start rounded-md border border-border-subtle px-2 py-1 text-xs font-medium text-text-dim hover:bg-bg-hover"
          @click="emit('open-settings')"
        >
          去设置添加世界观
        </button>
      </p>
      <template v-else>
        <!-- 搜索输入框 -->
        <input
          ref="searchInputEl"
          v-model="searchQuery"
          type="text"
          placeholder="搜索世界观…"
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
            v-for="w in filteredWorldviews"
            :key="w.id"
            type="button"
            class="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-bg-hover"
            @mousedown.prevent="pick(w.id)"
          >
            <span class="text-sm font-medium text-text-main">{{ w.name || '（未命名）' }}</span>
            <span v-if="w.scenario" class="line-clamp-1 text-xs text-text-dim">{{ w.scenario }}</span>
          </button>
          <p
            v-if="filteredWorldviews.length === 0"
            class="px-3 py-2 text-xs text-text-muted"
          >
            没有匹配「{{ searchQuery }}」的世界观
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
