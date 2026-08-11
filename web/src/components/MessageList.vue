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
 * 用户是否在滚动区底部附近。
 * 通过监听用户的手动滚动来更新，据此决定流式/新消息时是否自动跟随。
 */
const isNearBottom = ref(true)
/** 判定为「在底部」的阈值（距底部像素数） */
const BOTTOM_THRESHOLD = 80

function onScroll() {
  const el = scrollRef.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  isNearBottom.value = distance < BOTTOM_THRESHOLD
  // 同步阅读状态到 store（视窗跟随节奏用）
  session.setReadingState(isNearBottom.value)
}

/** 仅当用户已在底部时，才滚动到底部（避免打断用户浏览） */
async function maybeScrollToBottom() {
  if (!isNearBottom.value) return
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
