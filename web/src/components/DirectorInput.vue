<script setup lang="ts">
/**
 * 导演指令输入框
 *
 * 固定在消息区底部，用户以导演身份下达干预对话走向的指令。
 * 支持设置有效期（永久 / N 轮），发送后通过 REST API 添加。
 * 无论会话是否运行都可添加（指令会在下一轮 prompt 注入）。
 *
 * UI 借鉴 gpt-image-studio 的 PromptInputBox：
 * - 圆角容器，focus-within 时边框加深 + 阴影
 * - textarea 透明背景、自适应高度
 * - 底部行：有效期 pill 按钮（左）+ 发送按钮（右）
 */
import { computed, nextTick, ref } from 'vue'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{
  sessionId: string
}>()

const session = useSessionStore()

const text = ref('')
const durationRounds = ref(0) // 0 = 永久
const customMode = ref(false)
const customValue = ref(5)
const sending = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

/** 快捷过期选项 */
const durationOptions = [
  { label: '永久', value: 0 },
  { label: '3 轮', value: 3 },
  { label: '5 轮', value: 5 },
  { label: '10 轮', value: 10 },
]

const canSend = computed(() => text.value.trim().length > 0 && !sending.value)

/** 当前生效的 durationRounds（考虑自定义模式） */
const effectiveDuration = computed(() =>
  customMode.value ? Math.max(1, customValue.value) : durationRounds.value,
)

function selectOption(val: number) {
  customMode.value = false
  durationRounds.value = val
}

function selectCustom() {
  customMode.value = true
}

/** textarea 自适应高度（借鉴 gpt-image-studio resizeTextarea） */
function resizeTextarea() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

async function handleSend() {
  if (!canSend.value) return
  sending.value = true
  try {
    const ok = await session.addDirectorAction(
      props.sessionId,
      text.value.trim(),
      effectiveDuration.value,
    )
    if (ok) {
      text.value = ''
      await nextTick()
      resizeTextarea()
    }
  } finally {
    sending.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  // Enter 发送，Shift+Enter 换行
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function handleInput() {
  resizeTextarea()
}
</script>

<template>
  <div class="shrink-0 bg-bg px-3 pb-3 pt-2 md:px-4">
    <div
      class="mx-auto max-w-3xl rounded-2xl border bg-bg-card px-3.5 py-2.5 shadow-sm transition-all focus-within:border-text-dim focus-within:shadow-md"
    >
      <!-- 导演标识 + textarea：透明背景，自适应高度 -->
      <div class="flex items-start gap-2">
        <span class="mt-1 shrink-0 text-xs font-medium text-accent">导演</span>
        <textarea
          ref="textareaRef"
          v-model="text"
          rows="1"
          placeholder="下达指令干预对话走向（如：让话题转向…、加入一个冲突…）"
          class="min-h-[28px] max-h-32 flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed text-text-main outline-none placeholder:text-text-muted"
          :disabled="sending"
          @keydown="handleKeydown"
          @input="handleInput"
        />
      </div>

      <!-- 底部行：有效期 pill + 发送按钮 -->
      <div class="mt-2 flex items-center justify-between gap-2">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <span class="mr-0.5 text-xs text-text-muted">有效期</span>
          <button
            v-for="opt in durationOptions"
            :key="opt.value"
            type="button"
            class="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-colors"
            :class="!customMode && durationRounds === opt.value
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'bg-bg-hover text-text-dim hover:bg-border-subtle hover:text-text-main'"
            @click="selectOption(opt.value)"
          >
            {{ opt.label }}
          </button>
          <button
            type="button"
            class="flex cursor-pointer items-center gap-0.5 rounded-full px-2.5 py-1 text-xs transition-colors"
            :class="customMode
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'bg-bg-hover text-text-dim hover:bg-border-subtle hover:text-text-main'"
            @click="selectCustom"
          >
            <span>自定义</span>
            <svg class="h-3 w-3 opacity-60" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 5l3 3 3-3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <template v-if="customMode">
            <div class="flex items-center gap-1 rounded-full bg-bg-hover px-2 py-1">
              <input
                v-model.number="customValue"
                type="number"
                min="1"
                class="w-12 bg-transparent text-xs text-text-main outline-none"
              />
              <span class="text-xs text-text-muted">轮</span>
            </div>
          </template>
        </div>
        <button
          type="button"
          :disabled="!canSend"
          class="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-4 py-1.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-30"
          :class="canSend
            ? 'bg-accent text-white hover:bg-accent-hover'
            : 'bg-border-subtle text-text-dim'"
          @click="handleSend"
        >
          <svg v-if="!sending" class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
          <span>{{ sending ? '…' : '下达' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
