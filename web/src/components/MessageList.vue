<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import MessageBubble from './MessageBubble.vue'
import AppLogo from './AppLogo.vue'

const session = useSessionStore()
const { messages } = storeToRefs(session)

const scrollRef = ref<HTMLDivElement | null>(null)

/**
 * 用户是否完全贴在滚动区底部。
 * 必须无可滚动余量（distance <= 0）才为 true，向上滚任意像素即变为 false，
 * 避免流式自动跟随与用户手动滚动冲突导致的抖动。
 * （distance < 0 的情况：内容不足、未出现滚动条，同样视为贴底。）
 */
const isAtBottom = ref(true)

function onScroll() {
  const el = scrollRef.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  isAtBottom.value = distance <= 0
  // 同步阅读状态到 store（视窗跟随节奏用）
  session.setReadingState(isAtBottom.value)
}

/** 仅当用户完全贴底时，才滚动到底部（避免打断用户浏览 / 避免抖动） */
async function maybeScrollToBottom() {
  if (!isAtBottom.value) return
  await nextTick()
  const el = scrollRef.value
  if (el) el.scrollTop = el.scrollHeight
}

/** 有新消息时：若用户在底部则跟随 */
watch(() => messages.value.length, maybeScrollToBottom)

/** 流式内容增长时：若用户在底部则跟随 */
watch(
  () => messages.value[messages.value.length - 1]?.content,
  maybeScrollToBottom,
)
</script>

<template>
  <div
    ref="scrollRef"
    class="flex-1 overflow-y-auto px-3 py-4 md:px-4"
    @scroll="onScroll"
  >
    <!-- 空状态提示 -->
    <div
      v-if="messages.length === 0"
      class="flex h-full flex-col items-center justify-center text-text-muted"
    >
      <div class="mb-2">
        <AppLogo :size="40" />
      </div>
      <p class="text-sm">还没有消息，点击左侧「新建会话」开始</p>
    </div>

    <!-- 消息流 -->
    <div v-else class="flex flex-col gap-3">
      <MessageBubble v-for="msg in messages" :key="msg.uid" :message="msg" />
    </div>
  </div>
</template>
