<script setup lang="ts">
/**
 * 单个智能体选择卡（从智能体模板中选择，而非手填）。
 *
 * 两种态：
 *  - 未选择：搜索框 + 下拉列表，输入时按名字筛选，点击即选中。
 *  - 已选择：展示该智能体名 + description 摘要 + 颜色选择器 + 更换/移除。
 *
 * 通过 index 绑定 form store 的 agents 数组对应项。
 */
import { computed, nextTick, ref } from 'vue'
import { useFormStore } from '@/stores/form'
import { useTemplateStore } from '@/stores/template'
import { AGENT_COLOR_OPTIONS, isPresetColor, MIN_AGENTS } from '@/types/api'
import { bgColor, textColor, resolveColor } from '@/utils/agentColor'
import type { AgentTemplate } from '@/services/templates'

const props = defineProps<{
  /** 该智能体在 agents 数组中的索引 */
  index: number
}>()

const form = useFormStore()
const template = useTemplateStore()

const agent = computed(() => form.values.agents[props.index])
const label = computed(() => `智能体 ${String.fromCharCode(65 + props.index)}`)
const color = computed(() => resolveColor(agent.value?.color, props.index))
/** 当前是否为自定义颜色（非预设 key） */
const isCustomColor = computed(() => !isPresetColor(color.value))
const canRemove = computed(() => form.values.agents.length > MIN_AGENTS)

/** 已被其它槽位占用的模板 id（避免同一会话重复选同一智能体） */
const usedTemplateIds = computed(() => {
  const set = new Set<string>()
  form.values.agents.forEach((a, i) => {
    if (i !== props.index && a.templateId) set.add(a.templateId)
  })
  return set
})

/** 可选模板（排除已被其它槽位选中的） */
const availableTemplates = computed(() =>
  template.agents.filter((t) => !usedTemplateIds.value.has(t.id)),
)

const selected = computed(() => agent.value && agent.value.templateId !== '')

/* --------------------------- 搜索 + 下拉 --------------------------- */

const searchQuery = ref('')
/** 下拉是否展开 */
const dropdownOpen = ref(false)
const searchInputEl = ref<HTMLInputElement | null>(null)

/** 按名字筛选后的可选模板 */
const filteredTemplates = computed<AgentTemplate[]>(() => {
  const kw = searchQuery.value.trim().toLowerCase()
  const list = availableTemplates.value
  if (!kw) return list
  return list.filter(
    (t) =>
      t.name.toLowerCase().includes(kw) ||
      t.description.toLowerCase().includes(kw) ||
      t.personality.toLowerCase().includes(kw),
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
  const t = template.findAgent(tid)
  if (!t) return
  form.selectTemplate(
    props.index,
    t.id,
    t.name,
    t.description,
    t.personality,
  )
  searchQuery.value = ''
  dropdownOpen.value = false
}

function change() {
  form.clearTemplate(props.index)
  searchQuery.value = ''
  // 清除后自动展开下拉方便重选
  void openDropdown()
}

function remove() {
  form.removeAgent(props.index)
}

function pickColor(c: (typeof AGENT_COLOR_OPTIONS)[number]['key']) {
  form.patchAgent(props.index, { color: c })
}

/** 自定义颜色：原生取色器 input 事件 */
function pickCustomHex(e: Event) {
  const hex = (e.target as HTMLInputElement).value
  if (hex) form.patchAgent(props.index, { color: hex })
}
</script>

<template>
  <div v-if="agent" class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="h-2.5 w-2.5 rounded-full" :class="bgColor(color).class" :style="bgColor(color).style" />
        <span class="text-xs font-medium" :class="textColor(color).class" :style="textColor(color).style">{{ label }}</span>
      </div>
      <button
        v-if="canRemove"
        type="button"
        class="rounded-md px-1.5 py-0.5 text-xs text-text-muted hover:bg-danger/10 hover:text-danger"
        aria-label="移除该智能体"
        @click="remove"
      >
        移除
      </button>
    </div>

    <!-- 已选择：展示智能体卡片 -->
    <div
      v-if="selected"
      class="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-card p-3"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-text-main">{{ agent.name }}</p>
          <p
            v-if="agent.description"
            class="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-dim"
          >
            {{ agent.description }}
          </p>
          <p v-else class="mt-0.5 text-xs text-text-muted">（未设定身份）</p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md border border-border-subtle px-2 py-1 text-xs text-text-dim hover:bg-bg-hover"
          @click="change"
        >
          更换
        </button>
      </div>

      <!-- 颜色选择器 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-text-dim">颜色</span>
        <button
          v-for="opt in AGENT_COLOR_OPTIONS"
          :key="opt.key"
          type="button"
          class="h-3.5 w-3.5 rounded-full border transition-transform hover:scale-110"
          :class="[
            bgColor(opt.key).class,
            agent.color === opt.key
              ? 'border-text-main ring-2 ring-text-main/40'
              : 'border-black/15',
          ]"
          :style="bgColor(opt.key).style"
          :aria-label="opt.label"
          :title="opt.label"
          @click="pickColor(opt.key)"
        />
        <!-- 自定义颜色取色器 -->
        <label
          class="relative flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full border transition-transform hover:scale-110"
          :class="isCustomColor ? 'ring-2 ring-text-main/40 border-text-main' : 'border-text-dim'"
          :style="isCustomColor ? { backgroundColor: color } : {}"
          title="自定义颜色"
          aria-label="自定义颜色"
        >
          <!-- 未选自定义时显示 + 号（SVG，几何居中，不受字形 metrics 影响） -->
          <svg
            v-if="!isCustomColor"
            class="h-2 w-2 text-text-dim"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M6 1.5v9M1.5 6h9" />
          </svg>
          <!-- 原生取色器（透明覆盖） -->
          <input
            type="color"
            class="absolute inset-0 cursor-pointer opacity-0"
            :value="isCustomColor ? color : '#2563eb'"
            @input="pickCustomHex"
          />
        </label>
      </div>
    </div>

    <!-- 未选择：搜索框 + 下拉 -->
    <div v-else class="relative flex flex-col gap-1">
      <!-- 空态提示 -->
      <p
        v-if="availableTemplates.length === 0"
        class="rounded-lg bg-bg-hover px-3 py-2 text-xs text-text-muted"
      >
        没有可选模板，请先在「设置」中添加智能体。
      </p>
      <template v-else>
        <!-- 搜索输入框 -->
        <input
          ref="searchInputEl"
          v-model="searchQuery"
          type="text"
          placeholder="搜索智能体…"
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
            v-for="t in filteredTemplates"
            :key="t.id"
            type="button"
            class="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-bg-hover"
            @mousedown.prevent="pick(t.id)"
          >
            <span class="text-sm font-medium text-text-main">{{ t.name || '（未命名）' }}</span>
            <span v-if="t.description" class="line-clamp-1 text-xs text-text-dim">{{ t.description }}</span>
          </button>
          <p
            v-if="filteredTemplates.length === 0"
            class="px-3 py-2 text-xs text-text-muted"
          >
            没有匹配「{{ searchQuery }}」的智能体
          </p>
        </div>
      </template>
    </div>
  </div>
</template>
