<script setup lang="ts">
/**
 * 会话工作区视图（路由 /sessions/:id）
 *
 * 布局：中间主区（上下结构：header + 消息列表）+ 右侧 SessionInspector。
 * 持有 WS 连接：
 *  - 新建对话场景：session.pendingStart=true，加载后建立 WS 并发送 start；
 *  - 历史/刷新场景：若会话仍在 running，建立 WS 监听后续流式；
 *  - 否则不连接 WS（查看历史）。
 *
 * 主区 header 承载：左侧栏 toggle（移动端汉堡/桌面收起箭头）+ 会话标题 + inspector toggle。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useSessionsStore } from '@/stores/sessions'
import { useWebSocket } from '@/composables/useWebSocket'
import { useBreakpoint } from '@/composables/useBreakpoint'
import MessageList from '@/components/MessageList.vue'
import SessionInspector from '@/components/SessionInspector.vue'
import type { ServerEvent, SessionStatus } from '@/types/api'

const props = defineProps<{ id: string }>()
const router = useRouter()
const session = useSessionStore()
const sessions = useSessionsStore()
const {
  status,
  pendingStart,
  inspectorOpen,
  sidebarCollapsed,
} = storeToRefs(session)
const { isMobile } = useBreakpoint()

const { open: openWs, send: sendWs, close: closeWs } = useWebSocket()

const loading = ref(true)
const loadError = ref<string | null>(null)

/** 主区 header 标题：会话话题，缺省回退品牌名 */
const headerTitle = computed(() => session.session?.topic ?? 'Duet')

/**
 * finished 事件 reason → 列表项 status 的映射。
 * 与后端 chatHandler.runLoop 的终态语义一致：
 *  - stopped / shutdown（用户停止或服务重启）→ stopped
 *  - error / crashed                       → error
 *  - max_rounds / duration / absolute_limit → finished
 */
function reasonToStatus(reason: string): SessionStatus {
  switch (reason) {
    case 'stopped':
    case 'shutdown':
      return 'stopped'
    case 'error':
    case 'crashed':
      return 'error'
    default:
      return 'finished'
  }
}

/** WS 事件分发器 */
function onEvent(msg: ServerEvent) {
  session.handleEvent(msg)
  const id = session.session?.id
  switch (msg.type) {
    case 'started':
      // 即时把列表项标记为 running（触发侧栏 spinner）
      if (id) sessions.patch(id, { status: 'running' })
      break
    case 'turn_end':
      // 更新消息数与时间，保持列表排序新鲜
      if (id) {
        sessions.patch(id, {
          messageCount: msg.messageCount,
          updatedAt: Date.now(),
        })
      }
      break
    case 'finished': {
      if (id) {
        // 先用 reason 推导终态即时刷新列表，再拉取权威数据对齐
        sessions.patch(id, { status: reasonToStatus(msg.reason) })
        void session.syncFinalStatus(id)
        void sessions.refresh()
      }
      break
    }
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
  <section class="flex min-w-0 flex-1 bg-bg">
    <!-- 中间主区：上下结构（header + 内容） -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 主区 header -->
      <header
        class="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-4"
      >
        <div class="flex min-w-0 items-center gap-2">
          <!-- 移动端：汉堡打开侧栏抽屉 -->
          <button
            type="button"
            class="rounded-lg p-1.5 text-text-dim transition-colors hover:bg-bg-hover hover:text-text-main lg:hidden"
            aria-label="打开侧栏"
            @click="session.toggleSidebar(true)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          <!-- 桌面：侧栏收起/展开 toggle -->
          <button
            type="button"
            class="hidden rounded-lg p-1.5 text-text-dim transition-colors hover:bg-bg-hover hover:text-text-main lg:block"
            :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
            @click="session.toggleSidebar(false)"
          >
            <!-- 收起态：汉堡（暗示可展开） -->
            <svg v-if="sidebarCollapsed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
            <!-- 展开态：左指箭头（收起侧栏） -->
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
          <h1 class="truncate text-base font-semibold text-text-main">
            {{ headerTitle }}
          </h1>
        </div>
        <div class="flex items-center gap-1">
          <!-- inspector toggle（> 箭头，收起时水平翻转） -->
          <button
            type="button"
            class="rounded-lg p-1.5 text-text-dim transition-colors hover:bg-bg-hover hover:text-text-main"
            aria-label="会话详情"
            title="会话详情"
            @click="session.toggleInspector()"
          >
            <svg
              width="20" height="20"
              class="transition-transform duration-200"
              :class="inspectorOpen ? '' : 'rotate-180'"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </header>

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

      <!-- 正常态：消息流 -->
      <MessageList v-else />
    </div>

    <!-- 右：会话详情（横向并排，仅正常态有意义但始终挂载以保持过渡） -->
    <SessionInspector
      v-if="!loading && !loadError"
      :open="inspectorOpen"
      :is-mobile="isMobile"
      @close="inspectorOpen = false"
      @stop="handleStop"
      @reset="handleReset"
    />
  </section>
</template>
