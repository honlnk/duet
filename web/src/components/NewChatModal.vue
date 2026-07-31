<script setup lang="ts">
/**
 * 新建对话模态框
 *
 * 把原侧边栏的「新建对话表单」（话题 + 智能体 A/B + 高级设置）搬进居中模态。
 * 提交：创建会话 → 保存草稿/历史 → 设置 pendingStart → 路由跳转（SessionView 据此启动 WS）。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useSessionsStore } from '@/stores/sessions'
import { useFormStore } from '@/stores/form'
import { useDraftStore } from '@/stores/draft'
import AgentForm from './AgentForm.vue'
import AdvancedSettings from './AdvancedSettings.vue'

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const session = useSessionStore()
const sessions = useSessionsStore()
const form = useFormStore()
const draft = useDraftStore()
const { values } = storeToRefs(form)

const submitting = ref(false)
const errorMsg = ref<string | null>(null)

/** 点遮罩关闭（防误触：按下和松开都在遮罩才关） */
let mouseDownOnOverlay = false
function onOverlayMouseDown() {
  mouseDownOnOverlay = true
}
function onOverlayClick(e: MouseEvent) {
  if (mouseDownOnOverlay && e.target === e.currentTarget) emit('close')
  mouseDownOnOverlay = false
}

/** 提交：创建会话并跳转 */
async function handleSubmit() {
  if (!form.hasTopic) {
    errorMsg.value = '请先填写话题'
    return
  }
  submitting.value = true
  errorMsg.value = null
  try {
    // 标记待启动，SessionView 加载该会话后据此建立 WS 并发送 start
    session.pendingStart = true
    const id = await session.create(form.payload)
    draft.saveToHistory({ ...form.values })
    // 刷新侧栏列表，让新会话出现在顶部
    await sessions.refresh()
    emit('close')
    router.push(`/sessions/${id}`)
  } catch (e) {
    errorMsg.value = `创建会话失败：${(e as Error).message}`
    session.pendingStart = false
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <!-- 遮罩 -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    @mousedown="onOverlayMouseDown"
    @click="onOverlayClick"
  >
    <!-- 模态卡片 -->
    <div
      class="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-xl"
    >
      <!-- 头部 -->
      <div class="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-3.5">
        <h2 class="text-base font-semibold text-text-main">新建对话</h2>
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

      <!-- 表单主体（可滚动） -->
      <div class="flex flex-col gap-4 overflow-y-auto px-5 py-4">
        <!-- 话题 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-text-dim">话题</label>
          <textarea
            v-model="values.topic"
            rows="3"
            placeholder="想让两个 AI 讨论什么？"
            class="w-full resize-y rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-main outline-none focus:border-focus focus:ring-1 focus:ring-focus"
          />
        </div>

        <!-- 智能体 A / B -->
        <AgentForm agent-id="A" />
        <AgentForm agent-id="B" />

        <!-- 高级设置（折叠） -->
        <AdvancedSettings />

        <!-- 错误提示 -->
        <p v-if="errorMsg" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {{ errorMsg }}
        </p>
      </div>

      <!-- 底部操作 -->
      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
        <button
          type="button"
          class="rounded-lg border border-border-subtle bg-white px-4 py-2 text-sm font-medium text-text-dim hover:bg-bg-hover"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="button"
          :disabled="!form.hasTopic || submitting"
          class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          @click="handleSubmit"
        >
          {{ submitting ? '创建中…' : '开始对话' }}
        </button>
      </div>
    </div>
  </div>
</template>
