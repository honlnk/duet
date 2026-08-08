<script setup lang="ts">
/**
 * Prompt 历史查看模态框
 *
 * 展示当前会话「最近发给 LLM 的完整 Prompt」快照。
 * 左侧：智能体列表（可切换查看不同智能体的 prompt）。
 * 右侧：选中智能体的快照列表，按时间倒序（最新在前），每条可展开查看完整 messages。
 *
 * 数据来源：GET /api/sessions/:id/prompts
 * 后端在每次 buildApiMessages 之后、chatCompletion 之前捕获，所见即所发。
 */
import { computed, ref, watch } from 'vue'
import { getRecentPrompts } from '@/services/api'
import { resolveColor, colorHex } from '@/utils/agentColor'
import type { Agent, AgentId, PromptSnapshot } from '@/types/api'

const props = defineProps<{
  sessionId: string
  agents: Agent[]
}>()

const emit = defineEmits<{ close: [] }>()

const MAX_PER_AGENT = 20

/** 当前选中的智能体 */
const selectedAgentId = ref<AgentId | null>(props.agents[0]?.id ?? null)

/** 全部快照（未按 agent 过滤，一次性拉取，本地过滤，避免频繁请求） */
const snapshots = ref<PromptSnapshot[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
/** 当前展开查看的快照 timestamp（同时展开多个用 Set） */
const expanded = ref<Set<number>>(new Set())

/** 选中智能体的快照（按时间倒序，最新在前） */
const filteredSnapshots = computed(() => {
  if (!selectedAgentId.value) return []
  return snapshots.value
    .filter((s) => s.agentId === selectedAgentId.value)
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
})

/** 智能体名 → 是否有快照（左侧列表显示徽标） */
const agentHasPrompts = computed(() => {
  const map = new Map<AgentId, boolean>()
  for (const s of snapshots.value) map.set(s.agentId, true)
  return map
})

/** 拉取全部智能体的 prompt 历史（一次拉取，本地过滤） */
async function fetchAll() {
  loading.value = true
  loadError.value = null
  try {
    const res = await getRecentPrompts(props.sessionId, undefined, MAX_PER_AGENT * props.agents.length)
    snapshots.value = res.prompts
  } catch (e) {
    loadError.value = (e as Error).message
    snapshots.value = []
  } finally {
    loading.value = false
  }
}

/** 刷新（手动按钮 + 新数据后） */
async function refresh() {
  await fetchAll()
}

/** 切换智能体时收起所有展开项 */
watch(selectedAgentId, () => {
  expanded.value = new Set()
})

/** 展开/收起某条快照 */
function toggleExpand(ts: number) {
  if (expanded.value.has(ts)) {
    expanded.value.delete(ts)
  } else {
    expanded.value.add(ts)
  }
  // 触发响应式更新（Set 的 add/delete 不被 Vue 追踪，需重新赋值）
  expanded.value = new Set(expanded.value)
}

/** 复制单条消息内容到剪贴板 */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 忽略剪贴板权限失败
  }
}

/** 复制整条快照（拍平为 role: content 文本） */
function snapshotToText(s: PromptSnapshot): string {
  return s.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')
}

/** 格式化时间 */
function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 角色标签着色（区分 system/user/assistant） */
function roleBadgeClass(role: string): string {
  if (role === 'system') return 'bg-purple-50 text-purple-700'
  if (role === 'user') return 'bg-blue-50 text-blue-700'
  return 'bg-green-50 text-green-700'
}

function roleLabel(role: string): string {
  if (role === 'system') return 'system'
  if (role === 'user') return 'user'
  return 'assistant'
}

/** 智能体颜色（左侧列表 dot，统一走 inline hex 背景，兼容预设/自定义） */
function agentDot(a: Agent, index: number) {
  const c = resolveColor(a.color, index)
  return { style: { backgroundColor: colorHex(c) } }
}

// 点遮罩关闭（防误触）
let mouseDownOnOverlay = false
function onOverlayMouseDown(e: MouseEvent) {
  mouseDownOnOverlay = e.target === e.currentTarget
}
function onOverlayClick(e: MouseEvent) {
  if (mouseDownOnOverlay && e.target === e.currentTarget) emit('close')
  mouseDownOnOverlay = false
}

// 初次挂载拉取
fetchAll()
</script>

<template>
  <!-- 遮罩 -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    @mousedown="onOverlayMouseDown"
    @click="onOverlayClick"
  >
    <!-- 模态卡片（左 agent 列表 + 右内容） -->
    <div
      class="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
    >
      <!-- 头部 -->
      <div class="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-3.5">
        <div class="flex items-center gap-2">
          <h2 class="text-base font-semibold text-text-main">Prompt 历史</h2>
          <span class="text-xs text-text-muted">最近发给 LLM 的完整提示词</span>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded-md px-2 py-1 text-xs text-text-dim transition-colors hover:bg-bg-hover hover:text-text-main"
            :disabled="loading"
            @click="refresh"
          >
            <span v-if="loading">加载中…</span>
            <span v-else>刷新</span>
          </button>
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
      </div>

      <!-- 主体：左 agent 列表 + 右内容 -->
      <div class="flex min-h-0 flex-1">
        <!-- 左侧：智能体列表 -->
        <nav class="w-44 shrink-0 overflow-y-auto border-r border-border-subtle bg-bg-soft p-2">
          <button
            v-for="(agent, i) in agents"
            :key="agent.id"
            type="button"
            class="mb-1 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
            :class="selectedAgentId === agent.id
              ? 'border-focus bg-bg-hover text-text-main'
              : 'border-transparent text-text-dim hover:bg-bg-hover'"
            @click="selectedAgentId = agent.id"
          >
            <span
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              :style="agentDot(agent, i).style"
            />
            <span class="flex-1 truncate">{{ agent.name }}</span>
            <span
              v-if="agentHasPrompts.get(agent.id)"
              class="h-1.5 w-1.5 rounded-full bg-focus"
              title="有记录"
            />
          </button>
        </nav>

        <!-- 右侧：快照列表 -->
        <div class="min-w-0 flex-1 overflow-y-auto p-4">
          <!-- 错误 -->
          <div v-if="loadError" class="py-10 text-center text-sm text-red-500">
            加载失败：{{ loadError }}
          </div>

          <!-- 加载中（首次） -->
          <div v-else-if="loading && snapshots.length === 0" class="py-10 text-center text-sm text-text-muted">
            加载中…
          </div>

          <!-- 空状态 -->
          <div v-else-if="filteredSnapshots.length === 0" class="py-10 text-center text-sm text-text-muted">
            <p>暂无 Prompt 记录</p>
            <p class="mt-1 text-xs">开始对话后，每次发送给 LLM 的完整提示词会在此显示</p>
          </div>

          <!-- 快照列表 -->
          <div v-else class="flex flex-col gap-3">
            <div
              v-for="(s, idx) in filteredSnapshots"
              :key="s.timestamp"
              class="rounded-lg border border-border-subtle bg-white"
            >
              <!-- 快照摘要条（点击展开） -->
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-bg-hover"
                @click="toggleExpand(s.timestamp)"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span class="shrink-0 rounded bg-bg-soft px-1.5 py-0.5 text-xs text-text-muted">
                    #{{ filteredSnapshots.length - idx }}
                  </span>
                  <span class="shrink-0 text-xs text-text-dim">第 {{ s.round }} 轮</span>
                  <span class="shrink-0 text-xs text-text-muted">{{ fmtTime(s.timestamp) }}</span>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="rounded bg-bg-soft px-1.5 py-0.5 text-xs text-text-muted">
                    {{ s.messages.length }} 条消息
                  </span>
                  <span class="rounded bg-bg-soft px-1.5 py-0.5 text-xs text-text-muted">{{ s.providerName }}</span>
                  <svg
                    class="transition-transform duration-200"
                    :class="expanded.has(s.timestamp) ? 'rotate-90' : ''"
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </button>

              <!-- 展开内容：完整 messages -->
              <div v-if="expanded.has(s.timestamp)" class="border-t border-border-subtle">
                <!-- 操作条 -->
                <div class="flex items-center justify-between px-4 py-2 text-xs text-text-muted">
                  <span>协议：{{ s.protocol }}</span>
                  <button
                    type="button"
                    class="rounded px-2 py-1 transition-colors hover:bg-bg-hover hover:text-text-main"
                    @click="copyText(snapshotToText(s))"
                  >
                    复制全部
                  </button>
                </div>
                <!-- messages 列表 -->
                <div class="flex flex-col gap-2 px-4 pb-4">
                  <div
                    v-for="(m, mi) in s.messages"
                    :key="mi"
                    class="group rounded-md border border-border-subtle bg-bg-soft/50 p-3"
                  >
                    <div class="mb-1.5 flex items-center justify-between">
                      <span
                        class="rounded px-1.5 py-0.5 text-xs font-medium"
                        :class="roleBadgeClass(m.role)"
                      >
                        {{ roleLabel(m.role) }}
                      </span>
                      <button
                        type="button"
                        class="rounded px-1.5 py-0.5 text-xs text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-main group-hover:opacity-100"
                        @click="copyText(m.content)"
                      >
                        复制
                      </button>
                    </div>
                    <pre class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-main">{{ m.content || '(空)' }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
