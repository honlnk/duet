<script setup lang="ts">
/**
 * 会话工作区视图（路由 /sessions/:id）
 *
 * 职责：按路由 :id 加载会话 → 渲染消息列表 + 事件日志 + 控制条（停止/重置）。
 * 持有 WS 连接：
 *  - 新建对话场景：session.pendingStart=true，加载后建立 WS 并发送 start；
 *  - 历史/刷新场景：若会话仍在 running，建立 WS 监听后续流式；
 *  - 否则不连接 WS（查看历史）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useSessionsStore } from '@/stores/sessions'
import { useWebSocket } from '@/composables/useWebSocket'
import MessageList from '@/components/MessageList.vue'
import EventLog from '@/components/EventLog.vue'
import StatsBar from '@/components/StatsBar.vue'
import type { ServerEvent } from '@/types/api'

const props = defineProps<{ id: string }>()
const router = useRouter()
const session = useSessionStore()
const sessions = useSessionsStore()
const { status, eventLog, pendingStart } = storeToRefs(session)

const { open: openWs, send: sendWs, close: closeWs } = useWebSocket()

const loading = ref(true)
const loadError = ref<string | null>(null)

/** 当前会话是否处于运行态 */
const isRunning = computed(() => status.value === 'running')

/** WS 事件分发器 */
function onEvent(msg: ServerEvent) {
  const result = session.handleEvent(msg)
  if (result === 'finished') {
    const id = session.session?.id
    if (id) void session.syncFinalStatus(id)
    // 刷新侧栏列表（轮次/状态/消息数可能更新）
    void sessions.refresh()
  }
}

/** 连接 WS 并在 open 时发送 start */
function startStream(id: string) {
  openWs(id, { onEvent })
  sendWs({ type: 'start' })
}

/** 停止当前会话 */
function handleStop() {
  sendWs({ type: 'stop' })
}

/** 重置：回到首页 */
function handleReset() {
  closeWs()
  session.clearSession()
  router.push('/')
}

/** 加载指定 id 的会话 */
async function loadSession(id: string) {
  loading.value = true
  loadError.value = null
  const ok = await session.load(id)
  loading.value = false
  if (!ok) {
    loadError.value = '会话不存在或已被删除'
    return
  }
  // 场景 A：新建对话后 pendingStart → 启动流式
  if (pendingStart.value) {
    pendingStart.value = false
    startStream(id)
    return
  }
  // 场景 B：历史会话仍在运行 → 恢复 WS 监听
  if (status.value === 'running') {
    startStream(id)
  }
}

/** 路由 :id 变化时重新加载 */
watch(
  () => props.id,
  (id, oldId) => {
    if (id && id !== oldId) {
      closeWs()
      void loadSession(id)
    }
  },
)

onMounted(() => {
  void loadSession(props.id)
})

onUnmounted(() => {
  closeWs()
})
</script>

<template>
  <section class="flex min-w-0 flex-1 flex-col bg-bg">
    <!-- 加载态 -->
    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center text-text-muted"
    >
      <span class="text-sm">加载会话…</span>
    </div>

    <!-- 错误态 -->
    <div
      v-else-if="loadError"
      class="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted"
    >
      <div class="text-3xl">∅</div>
      <p class="text-sm">{{ loadError }}</p>
      <button
        type="button"
        class="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-dim hover:bg-bg-hover"
        @click="router.push('/')"
      >
        返回首页
      </button>
    </div>

    <!-- 正常：消息流 + 事件日志 + 控制条 -->
    <template v-else>
      <MessageList />

      <!-- 运行统计栏（亮色底，有会话时显示） -->
      <StatsBar
        v-if="session.session"
        class="shrink-0 border-t border-border-subtle bg-bg-card px-3 py-2 md:px-4"
      />

      <!-- 运行中/有会话时的控制条 -->
      <div
        v-if="session.session"
        class="flex shrink-0 items-center gap-2 border-t border-border-subtle px-3 py-2 md:px-4"
      >
        <button
          v-if="isRunning"
          type="button"
          class="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
          @click="handleStop"
        >
          停止
        </button>
        <button
          type="button"
          class="rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-dim hover:bg-bg-hover"
          @click="handleReset"
        >
          返回
        </button>
      </div>

      <EventLog :items="eventLog" />
    </template>
  </section>
</template>
