<script setup lang="ts">
/**
 * 新建对话模态框
 *
 * 话题 + 智能体（2~3 个，从模板中选择）+ 高级设置。
 * 智能体不再手填，而是从「设置」中预配置的智能体模板里点选。
 * 提交：创建会话 → 保存草稿/历史 → 设置 pendingStart → 路由跳转。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useSessionsStore } from '@/stores/sessions'
import { useFormStore } from '@/stores/form'
import { useDraftStore } from '@/stores/draft'
import { useTemplateStore } from '@/stores/template'
import { MAX_AGENTS } from '@/types/api'
import AgentForm from './AgentForm.vue'
import TopicPicker from './TopicPicker.vue'
import AdvancedSettings from './AdvancedSettings.vue'

const emit = defineEmits<{ close: []; 'open-settings': [] }>()

const router = useRouter()
const session = useSessionStore()
const sessions = useSessionsStore()
const form = useFormStore()
const draft = useDraftStore()
const template = useTemplateStore()
const { values } = storeToRefs(form)

const submitting = ref(false)
const errorMsg = ref<string | null>(null)

/** 是否还能再添加智能体 */
const canAddAgent = computed(() => values.value.agents.length < MAX_AGENTS)

/** 是否完全没有智能体模板（引导用户去设置） */
const hasNoTemplates = computed(() => template.agents.length === 0)

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
  if (!form.canSubmit) {
    if (!form.hasTopic) {
      errorMsg.value = '请选择一个话题'
    } else if (!form.allAgentsSelected) {
      errorMsg.value = '请为每个智能体选择一个模板'
    }
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
        <!-- 话题（从模板选择） -->
        <TopicPicker @open-settings="emit('open-settings')" />

        <!-- 智能体列表（2~3 个） -->
        <div class="flex flex-col gap-4">
          <!-- 无模板引导 -->
          <div
            v-if="hasNoTemplates"
            class="flex flex-col gap-2 rounded-lg border border-dashed border-border-subtle bg-bg-card px-3 py-3 text-center"
          >
            <p class="text-sm text-text-dim">还没有智能体模板</p>
            <p class="text-xs text-text-muted">先去设置添加几个智能体，才能在这里选择</p>
            <button
              type="button"
              class="self-center rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-dim hover:bg-bg-hover"
              @click="emit('open-settings')"
            >
              去设置添加智能体
            </button>
          </div>
          <AgentForm
            v-for="(agent, idx) in values.agents"
            :key="idx"
            :index="idx"
          />
        </div>

        <!-- 添加智能体按钮 -->
        <button
          v-if="canAddAgent"
          type="button"
          class="self-start rounded-lg border border-dashed border-border-subtle px-3 py-1.5 text-sm text-text-dim transition-colors hover:bg-bg-hover hover:text-text-main"
          @click="form.addAgent()"
        >
          + 添加智能体（最多 {{ MAX_AGENTS }} 个）
        </button>

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
          :disabled="!form.canSubmit || submitting"
          class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          @click="handleSubmit"
        >
          {{ submitting ? '创建中…' : '开始对话' }}
        </button>
      </div>
    </div>
  </div>
</template>
