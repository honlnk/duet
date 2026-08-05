<script setup lang="ts">
/**
 * 关系编辑弹窗
 *
 * 点击关系图中的连线后弹出，编辑两个智能体之间的非对称关系：
 *  - A 视角对 B 的关系（第一人称）
 *  - B 视角对 A 的关系（第一人称）
 *
 * 关系数据以 "{fromId}->{toId}" 为 key 存储在 session.relationships 中。
 * 双向关系在 2 人场景下是一条连线对应两个 key。
 */
import { ref, watch } from 'vue'
import type { Agent } from '@/types/api'
import { bgColor, textColor, resolveColor } from '@/utils/agentColor'

const props = defineProps<{
  /** 是否打开 */
  open: boolean
  /** 连线源节点（Agent） */
  source: Agent | null
  /** 连线目标节点（Agent） */
  target: Agent | null
  /** A→B 的现有关系描述 */
  sourceToTarget: string
  /** B→A 的现有关系描述 */
  targetToSource: string
}>()

const emit = defineEmits<{
  /** 保存两个方向的关系描述 */
  save: [sourceToTarget: string, targetToSource: string]
  /** 删除该连线（移除两个方向的关系） */
  remove: []
  /** 关闭弹窗（不保存） */
  close: []
}>()

const a2b = ref('')
const b2a = ref('')

// 打开时同步现有值
watch(
  () => props.open,
  (open) => {
    if (open) {
      a2b.value = props.sourceToTarget
      b2a.value = props.targetToSource
    }
  },
  { immediate: true },
)

function sourceColor() {
  return resolveColor(props.source?.color, 0)
}

function targetColor() {
  return resolveColor(props.target?.color, 1)
}

function save() {
  emit('save', a2b.value.trim(), b2a.value.trim())
}

function remove() {
  emit('remove')
}

/** 点遮罩关闭（防误触：按下和松开都在遮罩才关） */
let mouseDownOnOverlay = false
function onOverlayMouseDown(e: MouseEvent) {
  mouseDownOnOverlay = e.target === e.currentTarget
}
function onOverlayClick(e: MouseEvent) {
  if (mouseDownOnOverlay && e.target === e.currentTarget) emit('close')
  mouseDownOnOverlay = false
}
</script>

<template>
  <div
    v-if="open && source && target"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
    @mousedown="onOverlayMouseDown"
    @click="onOverlayClick"
  >
    <div class="flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl">
      <!-- 头部 -->
      <div class="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-3.5">
        <div class="flex items-center gap-2">
          <h2 class="text-base font-semibold text-text-main">编辑关系</h2>
          <div class="flex items-center gap-1.5 text-sm">
            <span
              class="h-2.5 w-2.5 rounded-full"
              :class="bgColor(sourceColor()).class"
              :style="bgColor(sourceColor()).style"
            />
            <span
              class="font-medium"
              :class="textColor(sourceColor()).class"
              :style="textColor(sourceColor()).style"
            >{{ source.name }}</span>
            <span class="text-text-muted">↔</span>
            <span
              class="h-2.5 w-2.5 rounded-full"
              :class="bgColor(targetColor()).class"
              :style="bgColor(targetColor()).style"
            />
            <span
              class="font-medium"
              :class="textColor(targetColor()).class"
              :style="textColor(targetColor()).style"
            >{{ target.name }}</span>
          </div>
        </div>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-main"
          aria-label="关闭"
          @click="emit('close')"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- 表单 -->
      <div class="flex flex-col gap-4 overflow-y-auto px-5 py-4">
        <p class="text-xs text-text-muted">
          关系描述以第一人称撰写，允许两个视角的认知不同（信息差、误解、暧昧）。
        </p>

        <!-- A → B 视角 -->
        <div class="flex flex-col gap-1.5">
          <label class="flex items-center gap-1.5 text-xs font-medium text-text-dim">
            <span
              class="h-2 w-2 rounded-full"
              :class="bgColor(sourceColor()).class"
              :style="bgColor(sourceColor()).style"
            />
            {{ source.name }} 视角对 {{ target.name }} 的关系
          </label>
          <textarea
            v-model="a2b"
            rows="3"
            :placeholder="`${source.name} 是我的…（如：同桌、暗恋对象、竞争对手）`"
            class="w-full resize-y rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-focus focus:ring-1 focus:ring-focus"
          />
        </div>

        <!-- B → A 视角 -->
        <div class="flex flex-col gap-1.5">
          <label class="flex items-center gap-1.5 text-xs font-medium text-text-dim">
            <span
              class="h-2 w-2 rounded-full"
              :class="bgColor(targetColor()).class"
              :style="bgColor(targetColor()).style"
            />
            {{ target.name }} 视角对 {{ source.name }} 的关系
          </label>
          <textarea
            v-model="b2a"
            rows="3"
            :placeholder="`${target.name} 是我的…（如：同桌、Crush、竞争对手）`"
            class="w-full resize-y rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-focus focus:ring-1 focus:ring-focus"
          />
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="flex shrink-0 items-center justify-between gap-2 border-t border-border-subtle px-5 py-3">
        <button
          type="button"
          class="rounded-lg px-3 py-2 text-xs text-text-muted hover:bg-danger/10 hover:text-danger"
          @click="remove"
        >
          删除连线
        </button>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-border-subtle bg-white px-4 py-2 text-sm font-medium text-text-dim hover:bg-bg-hover"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            type="button"
            class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            @click="save"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
