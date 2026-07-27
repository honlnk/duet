<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useFormStore } from '@/stores/form'
import AgentForm from './AgentForm.vue'
import AdvancedSettings from './AdvancedSettings.vue'
import PresetSelector from './PresetSelector.vue'
import ActionButtonBar from './ActionButtonBar.vue'

const props = defineProps<{
  /** 平板/桌面：侧栏是否收起（内联模式） */
  collapsed: boolean
  /** 当前是否为手机断点 */
  isMobile: boolean
  /** 手机端：抽屉是否展开（覆盖模式） */
  drawerOpen: boolean
}>()
const emit = defineEmits<{ start: []; stop: []; reset: [] }>()

const form = useFormStore()
const { values } = storeToRefs(form)

/**
 * 侧栏类名根据模式派生：
 * - 手机：fixed 抽屉，覆盖在聊天区上，靠 translate-x 滑入/滑出
 * - 平板/桌面：内联并排，靠 w-0/w-64/lg:w-80 控制宽度
 */
const asideClass = computed(() => {
  if (props.isMobile) {
    return [
      'fixed inset-y-0 left-0 z-40 w-[85%] max-w-[340px] overflow-y-auto bg-bg-soft p-4 shadow-xl transition-transform duration-200',
      props.drawerOpen ? 'translate-x-0' : '-translate-x-full',
    ]
  }
  // 平板/桌面内联：border-r 分隔，宽度动画
  return [
    'flex flex-col gap-3 overflow-y-auto border-r border-border-subtle bg-bg-soft p-4 transition-all duration-200',
    props.collapsed
      ? 'w-0 overflow-hidden border-r-0 p-0'
      : 'w-64 lg:w-80',
  ]
})
</script>

<template>
  <aside :class="asideClass">
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
