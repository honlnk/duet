<script setup lang="ts">
/**
 * 会话详情右侧栏
 *
 * 聚合当前会话的「状态 + 控制 / 统计 / 智能体设定 / 事件日志」四区，
 * 取代原 SessionView 底部那组控制条 + StatsBar + EventLog。
 *
 * 布局参考 NovAI ContentPanel：默认收起（w-0），展开为 w-80；
 * 移动端走覆盖抽屉（fixed + 遮罩）。纯展示组件，WS 控制逻辑
 * 通过 emit 上抛由 SessionView 处理，本组件不碰 WebSocket。
 */
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useProviderStore } from '@/stores/provider'
import { useDurationTracker } from '@/composables/useDurationTracker'
import { bgColor, textColor, resolveColor } from '@/utils/agentColor'
import StatusBadge from './StatusBadge.vue'
import type { AgentId } from '@/types/api'

defineProps<{
  /** 是否展开 */
  open: boolean
  /** 移动端（<768）走覆盖抽屉 */
  isMobile: boolean
}>()

const emit = defineEmits<{
  close: []
  /** 停止当前会话（发 WS stop） */
  stop: []
  /** 返回首页（关 WS + 清会话 + 跳路由） */
  reset: []
  /** 继续对话（打开设置弹窗） */
  resume: []
}>()

const session = useSessionStore()
const provider = useProviderStore()
const {
  session: current,
  status,
  round,
  maxRounds,
  stats,
  startedAt,
  stoppedAt,
  durationSec,
  eventLog,
  viewSide,
  isStopping,
} = storeToRefs(session)

const { display: durationDisplay, start, stop: stopTimer } = useDurationTracker()

// 计时器随会话状态联动（与原 StatsBar 逻辑一致）
watch(
  () => [startedAt.value, durationSec.value, status.value] as const,
  ([sa, ds, st]) => {
    if (sa && st === 'running') {
      start(sa, ds)
    } else if (sa && (st === 'stopped' || st === 'finished')) {
      stopTimer(stoppedAt.value ?? undefined)
    } else {
      stopTimer()
    }
  },
  { immediate: true },
)

/* --------------------------- 派生展示 --------------------------- */

const isRunning = computed(() => status.value === 'running')

const topic = computed(() => current.value?.topic ?? '（未设定话题）')

/** 智能体列表（2~3 个），带颜色 dot */
const agents = computed(() => current.value?.agents ?? [])

/**
 * 各智能体使用的 Provider 名称（用户在 Provider 管理中自定义的名字）。
 * 解析优先级与后端 chatHandler.providerIdOf 保持一致：
 *   A/B/C → providerA/B/C；D~J → agentProviders[id]；均缺省回退默认 Provider。
 */
const agentProviders = computed<Record<string, string>>(() => {
  const cfg = current.value?.config
  const resolve = (pid: string | undefined) => {
    const p = provider.find(pid) ?? provider.find(provider.defaultId)
    return p?.name || '—'
  }
  const out: Record<string, string> = {}
  for (const a of agents.value) {
    let pid: string | undefined
    if (a.id === 'A') pid = cfg?.providerA
    else if (a.id === 'B') pid = cfg?.providerB
    else if (a.id === 'C') pid = cfg?.providerC
    else pid = cfg?.agentProviders?.[a.id]
    out[a.id] = resolve(pid)
  }
  return out
})

/** 智能体颜色 dot（按 agent.color 解析，预设→class / 自定义→style） */
function agentDot(id: AgentId) {
  const idx = agents.value.findIndex((a) => a.id === id)
  const color = resolveColor(agents.value[idx]?.color, idx)
  return bgColor(color)
}

/** 智能体名称颜色 */
function agentText(id: AgentId) {
  const idx = agents.value.findIndex((a) => a.id === id)
  const color = resolveColor(agents.value[idx]?.color, idx)
  return textColor(color)
}

/** 轮次展示：次数模式或无限模式 */
const roundText = computed(() => {
  const max = maxRounds.value > 0 ? maxRounds.value : '∞'
  return `${round.value} / ${max}`
})

/** 成本展示：根据 costCurrency 选择货币符号 */
const costText = computed(() => {
  const cur = stats.value.costCurrency || 'CNY'
  const symbol = cur === 'CNY' ? '¥' : cur === 'USD' ? '$' : cur + ' '
  return `${symbol}${stats.value.estCost.toFixed(4)}`
})

/** 缓存命中率 */
const cacheHitRate = computed(() => {
  const hit = stats.value.totalCacheHitTokens
  const miss = stats.value.totalCacheMissTokens
  const total = hit + miss
  if (total === 0) return '0%'
  return `${((hit / total) * 100).toFixed(1)}%`
})

/** 总字数：超过万则以万为单位 */
const charsText = computed(() => {
  const n = stats.value.totalChars
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万字`
  return `${n}字`
})

/** token 统计项（用于统计区键值对） */
const statRows = computed(() => [
  { label: '输入 token', value: stats.value.totalPromptTokens.toLocaleString() },
  { label: '输出 token', value: stats.value.totalCompletionTokens.toLocaleString() },
  { label: '合计 token', value: stats.value.totalTokens.toLocaleString() },
  { label: '预估成本', value: costText.value, accent: true },
  { label: '缓存命中', value: cacheHitRate.value },
  { label: '总字数', value: charsText.value },
])

/** 事件日志为空判断 */
const hasEvents = computed(() => eventLog.value.length > 0)
</script>

<template>
  <!-- 移动端遮罩 -->
  <div
    v-if="open && isMobile"
    class="fixed inset-0 z-40 bg-black/50 lg:hidden"
    @click="emit('close')"
  />

  <!-- 右侧栏本体 -->
  <aside
    :class="[
      'flex shrink-0 flex-col border-l border-border-subtle bg-bg-card',
      // 移动端：固定定位 + 抽屉滑入；PC 端：内联，宽度由 open 控制
      isMobile
        ? 'fixed inset-y-0 right-0 z-50 w-80 ' +
          (open ? 'translate-x-0' : 'translate-x-full')
        : open
          ? 'w-80'
          : 'w-0 overflow-hidden border-l-0',
      'transition-all duration-200',
    ]"
  >
    <!-- 头部 -->
    <div
      class="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-4"
    >
      <h2 class="text-sm font-semibold text-text-main">会话详情</h2>
      <!-- 关闭按钮：仅移动端显示（PC 端由主区 header 的箭头 toggle 控制） -->
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim hover:bg-bg-hover hover:text-text-main lg:hidden"
        aria-label="收起"
        @click="emit('close')"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
    </div>

    <!-- 内容区（纵向滚动） -->
    <div class="flex-1 overflow-y-auto p-4">
      <!-- ① 运行状态 -->
      <section class="mb-5">
        <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          运行状态
        </h3>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusBadge :status="status" />
          <span class="text-xs text-text-dim">{{ durationDisplay }}</span>
          <span class="text-xs text-text-dim">·</span>
          <span class="text-xs text-text-dim">
            轮次 <span class="font-medium text-text-main">{{ roundText }}</span>
          </span>
        </div>
      </section>

      <!-- ② 使用的 Provider -->
      <section class="mb-5">
        <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          使用的 Provider
        </h3>
        <div class="flex flex-col gap-1.5">
          <div
            v-for="agent in agents"
            :key="agent.id"
            class="flex items-center gap-2 text-xs"
          >
            <span class="h-2 w-2 shrink-0 rounded-full" :class="agentDot(agent.id).class" :style="agentDot(agent.id).style" />
            <span class="shrink-0 text-text-dim">{{ agent.name }}</span>
            <span class="truncate text-text-main">{{ agentProviders[agent.id] }}</span>
          </div>
        </div>
      </section>

      <!-- ③ 统计（成本/token 等） -->
      <section class="mb-5">
        <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          统计
        </h3>
        <dl class="divide-y divide-border-subtle rounded-lg border border-border-subtle">
          <div
            v-for="row in statRows"
            :key="row.label"
            class="flex items-center justify-between px-3 py-2 text-xs"
          >
            <dt class="text-text-dim">{{ row.label }}</dt>
            <dd
              class="font-medium"
              :class="row.accent ? 'text-accent' : 'text-text-main'"
            >
              {{ row.value }}
            </dd>
          </div>
        </dl>
      </section>

      <!-- ④ 智能体视角（选择哪个智能体消息靠右显示） -->
      <section class="mb-5">
        <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          智能体视角
        </h3>
        <p class="mb-2 text-xs text-text-muted">选中智能体的消息靠右显示</p>
        <div class="flex flex-col gap-1.5">
          <button
            v-for="agent in agents"
            :key="agent.id"
            type="button"
            class="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
            :class="viewSide === agent.id
              ? 'border-focus bg-bg-hover text-text-main'
              : 'border-border-subtle text-text-dim hover:bg-bg-hover'"
            @click="session.setViewSide(agent.id)"
          >
            <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="agentDot(agent.id).class" :style="agentDot(agent.id).style" />
            <span class="flex-1 truncate">{{ agent.name }}</span>
            <span
              v-if="viewSide === agent.id"
              class="text-xs text-focus"
            >右侧</span>
          </button>
        </div>
      </section>

      <!-- ⑤ 智能体设定 -->
      <section class="mb-5">
        <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          智能体
        </h3>
        <!-- 话题 -->
        <div class="mb-2 rounded-lg bg-bg-hover px-3 py-2">
          <div class="text-xs text-text-muted">话题</div>
          <div class="mt-0.5 text-sm text-text-main">{{ topic }}</div>
        </div>
        <!-- 每个 Agent -->
        <div
          v-for="agent in agents"
          :key="agent.id"
          class="mb-2 rounded-lg border border-border-subtle p-3"
        >
          <div class="mb-1.5 flex items-center gap-2">
            <span class="h-2 w-2 rounded-full" :class="agentDot(agent.id).class" :style="agentDot(agent.id).style" />
            <span class="text-sm font-medium" :class="agentText(agent.id).class" :style="agentText(agent.id).style">{{ agent.name }}</span>
            <span class="text-xs text-text-muted">智能体 {{ agent.id }}</span>
          </div>
          <p
            v-if="agent.description"
            class="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-text-dim"
          >
            {{ agent.description }}
          </p>
          <p v-else class="text-xs text-text-muted">（未设定身份）</p>
          <p v-if="agent.personality" class="mt-1 text-xs text-text-muted">
            性格：{{ agent.personality }}
          </p>
        </div>
      </section>

      <!-- ⑤ 事件日志 -->
      <section>
        <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
          事件日志
        </h3>
        <div
          v-if="hasEvents"
          class="flex flex-col gap-1"
        >
          <div
            v-for="item in eventLog"
            :key="item.id"
            class="border-l-2 pl-2 py-0.5 text-xs"
            :class="{
              'border-accent text-text-dim': item.type === 'summary',
              'border-danger text-danger': item.type === 'error',
              'border-border-subtle text-text-muted': item.type === 'info',
            }"
          >
            {{ item.text }}
          </div>
        </div>
        <p v-else class="text-xs text-text-muted">暂无事件</p>
      </section>
    </div>

    <!-- footer：控制按钮（固定在右侧面板底部，不随内容滚动） -->
    <div
      class="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-4"
    >
      <button
        v-if="isRunning"
        type="button"
        :disabled="isStopping"
        class="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
        :class="isStopping
          ? 'cursor-not-allowed border-border-subtle text-text-muted'
          : 'border-danger text-danger hover:bg-danger/10'"
        @click="emit('stop')"
      >
        {{ isStopping ? '暂停中…' : '暂停' }}
      </button>
      <button
        v-else
        type="button"
        class="rounded-lg bg-focus px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        @click="emit('resume')"
      >
        继续对话
      </button>
      <button
        type="button"
        class="rounded-lg border border-border-subtle px-3 py-1.5 text-xs text-text-dim hover:bg-bg-hover"
        @click="emit('reset')"
      >
        返回首页
      </button>
    </div>

  </aside>
</template>
