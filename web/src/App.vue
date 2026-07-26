<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useFormStore } from '@/stores/form'
import { useDraftStore } from '@/stores/draft'
import { useConfigStore } from '@/stores/config'
import { useWebSocket } from '@/composables/useWebSocket'
import AppHeader from '@/components/AppHeader.vue'
import SettingsSidebar from '@/components/SettingsSidebar.vue'
import MessageList from '@/components/MessageList.vue'
import EventLog from '@/components/EventLog.vue'
import type { ServerEvent } from '@/types/api'

const session = useSessionStore()
const form = useFormStore()
const draft = useDraftStore()
const config = useConfigStore()
const { status, eventLog } = storeToRefs(session)

const { connected, open: openWs, send: sendWs, close: closeWs } = useWebSocket()

const sidebarCollapsed = ref(false)

/** 草稿自动保存：监听表单字段变化，防抖存盘 */
watch(
  () => ({ ...form.values }),
  (vals) => draft.scheduleSave(vals),
  { deep: true },
)

/** WS 事件分发器 */
function onEvent(msg: ServerEvent) {
  const result = session.handleEvent(msg)
  if (result === 'finished') {
    // 重拉权威终态
    const id = session.session?.id
    if (id) void session.syncFinalStatus(id)
  }
}

/* ----------------------------- 动作 ----------------------------- */

/** 开始对话 */
async function handleStart() {
  if (!form.hasTopic) {
    session.log('error', '请先填写话题')
    return
  }
  try {
    // 创建会话 → 渲染 → 保存到历史
    const id = await session.create(form.payload)
    draft.saveToHistory({ ...form.values })
    // 连接 WS 并在 onOpen 自动发送 start
    openWs(id, { onEvent })
    sendWs({ type: 'start' })
  } catch (e) {
    session.log('error', `创建会话失败：${(e as Error).message}`)
  }
}

/** 停止对话 */
function handleStop() {
  sendWs({ type: 'stop' })
}

/** 重置 */
function handleReset() {
  closeWs()
  session.clearSession()
}

/* --------------------------- 生命周期 --------------------------- */

onMounted(async () => {
  // 拉取全局限制
  await config.load()
  // 恢复草稿
  const saved = draft.readDraft()
  if (saved) {
    form.replace(saved)
    session.log('info', '已恢复上次的草稿')
  }
})

// 连接状态变化时记日志（可选，便于调试）
watch(connected, (c) => {
  if (!c && status.value === 'running') {
    session.log('info', '连接断开，正在重连…')
  }
})
</script>

<template>
  <div class="flex h-full flex-col">
    <AppHeader />

    <main class="flex min-h-0 flex-1">
      <!-- 侧栏 -->
      <SettingsSidebar
        v-model:collapsed="sidebarCollapsed"
        @start="handleStart"
        @stop="handleStop"
        @reset="handleReset"
      />

      <!-- 聊天区 -->
      <section class="flex min-w-0 flex-1 flex-col bg-bg">
        <MessageList />
        <EventLog :items="eventLog" />
      </section>
    </main>
  </div>
</template>
