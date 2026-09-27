<script setup lang="ts">
/**
 * 导演助手挂件（Agent Loop 的前端入口）
 *
 * 右下角机器人悬浮按钮 → 弹框聊天。与聊天室的固定策略对话不同，
 * 这里走 POST /api/agent/chat 的 SSE 流：模型可以调用工具直接增删改查
 * 资产库（角色/话题/世界观模板 + 关系），工具行内联展示、可展开看详情。
 *
 * 联动：收到 mutated 的 tool_result 后重新拉取模板/关系 store，
 * 让设置弹窗、关系画布等页面数据自动更新。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useProviderStore } from '@/stores/provider'
import { useTemplateStore } from '@/stores/template'
import { useRelationshipStore } from '@/stores/relationship'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { fetchThinkingOptions } from '@/services/api'
import type { ThinkingOption } from '@/types/api'

/* --------------------------- Stores --------------------------- */

const providerStore = useProviderStore()
const { providers, defaultId } = storeToRefs(providerStore)
const templateStore = useTemplateStore()
const relationshipStore = useRelationshipStore()
const { isMobile } = useBreakpoint()

/* --------------------------- 面板开关 --------------------------- */

const open = ref(false)

function toggle() {
  open.value = !open.value
  if (open.value) {
    // 首次打开回填默认 Provider
    if (!providerId.value) providerId.value = defaultId.value
    nextTick(() => inputRef.value?.focus())
  }
}

// Esc 关闭（仅键盘可达性；桌面面板无遮罩）
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) open.value = false
}
if (typeof window !== 'undefined') window.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown)
})

/* --------------------------- 会话与消息模型 --------------------------- */

/** 会话 id：组件实例持有，刷新页面即新会话（服务端 2h 空闲过期，不持久化） */
const sessionId = makeId()

function makeId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

interface ToolItem {
  kind: 'tool'
  uid: number
  name: string
  summary: string
  args: Record<string, unknown>
  status: 'running' | 'ok' | 'fail'
  detail: string
  mutated: boolean
  expanded: boolean
}
interface ChatItem {
  kind: 'user' | 'assistant' | 'system'
  uid: number
  content: string
  /** system 条目是否为错误色 */
  error?: boolean
  /** assistant 是否已封闭（工具调用后收到新一轮 delta 时要另起一条） */
  sealed?: boolean
}
type Item = ToolItem | ChatItem

const items = ref<Item[]>([])
let uidSeed = 0

function nextUid(): number {
  return ++uidSeed
}

/** 空态示例指令 */
const EXAMPLES = [
  '帮我创建一个角色：林小雨，大学生，性格内向但心思细腻',
  '列出现有的角色模板',
  '给小张和小美设置同桌关系',
]

const hasChat = computed(() => items.value.length > 0)

/* --------------------------- 模型 / 思考强度选择 --------------------------- */

const providerId = ref('')
const thinking = ref('')
const thinkingOpts = ref<ThinkingOption[]>([])
const thinkingSupported = ref(false)
const thinkingLoading = ref(false)

const model = computed(() => providerStore.find(providerId.value)?.model ?? '')

function providerLabel(id: string): string {
  const p = providerStore.find(id)
  if (!p) return ''
  return `${p.name}（${p.model}）`
}

watch(providerId, loadThinkingOptions)

async function loadThinkingOptions() {
  thinking.value = ''
  thinkingOpts.value = []
  thinkingSupported.value = false
  if (!providerId.value) return
  thinkingLoading.value = true
  try {
    const resp = await fetchThinkingOptions(providerId.value)
    thinkingOpts.value = resp.options
    thinkingSupported.value = resp.supported
  } catch {
    // 拉取失败按「不支持」处理，不阻塞聊天
  } finally {
    thinkingLoading.value = false
  }
}

/* --------------------------- SSE 消费 --------------------------- */

const input = ref('')
const streaming = ref(false)
const sendError = ref('')
let abortCtl: AbortController | null = null

const scrollRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)

/** 只在用户本来就贴底时才自动跟随（避免打扰回看历史） */
function scrollToBottom(force = false): void {
  const el = scrollRef.value
  if (!el) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  if (force || nearBottom) el.scrollTop = el.scrollHeight
}

/** 取当前可续写的 assistant 条目；没有则新起一条 */
function ensureAssistant(): ChatItem {
  const last = items.value[items.value.length - 1]
  if (last && last.kind === 'assistant' && !last.sealed) return last
  const msg: ChatItem = { kind: 'assistant', uid: nextUid(), content: '' }
  items.value.push(msg)
  return msg
}

function pushSystem(text: string, error = false): void {
  items.value.push({ kind: 'system', uid: nextUid(), content: text, error })
}

function handleServerEvent(event: string, raw: string): void {
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  switch (event) {
    case 'delta': {
      ensureAssistant().content += String(data.text ?? '')
      break
    }
    case 'tool_call': {
      // 封闭当前 assistant 气泡，工具行插在其后
      const last = items.value[items.value.length - 1]
      if (last && last.kind === 'assistant') last.sealed = true
      items.value.push({
        kind: 'tool',
        uid: nextUid(),
        name: String(data.name ?? ''),
        summary: String(data.summary ?? ''),
        args: (data.args as Record<string, unknown>) ?? {},
        status: 'running',
        detail: '',
        mutated: false,
        expanded: false,
      })
      break
    }
    case 'tool_result': {
      // 配对同名且仍在 running 的最后一行
      for (let i = items.value.length - 1; i >= 0; i--) {
        const it = items.value[i]
        if (it && it.kind === 'tool' && it.name === String(data.name ?? '') && it.status === 'running') {
          it.status = data.ok ? 'ok' : 'fail'
          it.detail = String(data.summary ?? '')
          it.mutated = Boolean(data.mutated)
          break
        }
      }
      if (data.mutated) scheduleLibraryRefresh()
      break
    }
    case 'assistant': {
      // 最终全文（比 delta 拼接更可靠，直接覆盖最后一条 assistant）
      const last = items.value[items.value.length - 1]
      if (last && last.kind === 'assistant') last.content = String(data.content ?? '')
      else items.value.push({ kind: 'assistant', uid: nextUid(), content: String(data.content ?? '') })
      break
    }
    case 'error': {
      pushSystem(`出错了：${String(data.message ?? '未知错误')}`, true)
      break
    }
    case 'done': {
      const reason = String(data.reason ?? '')
      if (reason === 'turn_limit')
        pushSystem('已达到本轮工具调用上限，先停在这里。可以继续发消息让我接着做。')
      else if (reason === 'aborted') pushSystem('已停止。')
      break
    }
  }
  nextTick(() => scrollToBottom())
}

/* --------------------------- 资产联动刷新 --------------------------- */

let refreshTimer: ReturnType<typeof setTimeout> | null = null

/** 短 debounce：一批工具结果只触发一轮 store 刷新 */
function scheduleLibraryRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void templateStore.refresh()
    void relationshipStore.refresh()
  }, 200)
}

/* --------------------------- 发送 / 停止 --------------------------- */

const canSend = computed(
  () => !streaming.value && input.value.trim().length > 0 && Boolean(providerId.value && model.value),
)

async function send(preset?: string): Promise<void> {
  const text = (preset ?? input.value).trim()
  if (!text || streaming.value) return
  if (!providerId.value || !model.value) {
    sendError.value = '请先在设置中添加 Provider（模型连接）'
    return
  }
  sendError.value = ''
  input.value = ''
  items.value.push({ kind: 'user', uid: nextUid(), content: text })
  ensureAssistant()
  streaming.value = true
  nextTick(() => scrollToBottom(true))

  abortCtl = new AbortController()
  try {
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        text,
        providerId: providerId.value,
        model: model.value,
        thinking: thinking.value || undefined,
      }),
      signal: abortCtl.signal,
    })
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      throw new Error(body || `HTTP ${res.status}`)
    }
    await consumeSSE(res.body, handleServerEvent)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      pushSystem('已停止。')
    } else {
      pushSystem(`连接失败：${e instanceof Error ? e.message : String(e)}`, true)
    }
  } finally {
    streaming.value = false
    abortCtl = null
    // 收尾：丢掉空的 assistant 占位（如中止在 delta 之前）
    const last = items.value[items.value.length - 1]
    if (last && last.kind === 'assistant' && last.content === '') items.value.pop()
    nextTick(() => scrollToBottom())
  }
}

function stop(): void {
  abortCtl?.abort()
}

/** 手写 SSE 解析（POST 流式响应，浏览器 EventSource 不适用） */
async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const parsed = parseSSEBlock(raw)
        if (parsed) onEvent(parsed.event, parsed.data)
      }
    }
    const tail = parseSSEBlock(buffer)
    if (tail) onEvent(tail.event, tail.data)
  } finally {
    reader.releaseLock()
  }
}

function parseSSEBlock(raw: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0 && event === 'message') return null
  return { event, data: dataLines.join('\n') }
}

/** Enter 发送 / Shift+Enter 换行 */
function onInputKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}

function fillExample(text: string): void {
  input.value = text
  inputRef.value?.focus()
}
</script>

<template>
  <!-- 悬浮按钮 -->
  <button
    v-if="!open"
    type="button"
    aria-label="打开导演助手"
    class="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-transform hover:scale-105 hover:bg-accent-hover"
    @click="toggle"
  >
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <circle cx="9" cy="14" r="1" fill="currentColor" />
      <circle cx="15" cy="14" r="1" fill="currentColor" />
      <path d="M12 8V5.5" />
      <circle cx="12" cy="4" r="1.2" />
    </svg>
  </button>

  <!-- 助手面板：桌面右下角锚定，移动端全屏 -->
  <div
    v-if="open"
    :class="
      isMobile
        ? 'fixed inset-0 z-50 flex flex-col bg-white'
        : 'fixed bottom-24 right-5 z-50 flex h-[min(75vh,42rem)] w-96 flex-col overflow-hidden rounded-xl border border-border-subtle bg-white shadow-2xl'
    "
  >
    <!-- 头部 -->
    <div class="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="8" width="16" height="12" rx="2" />
            <circle cx="9" cy="14" r="1" fill="currentColor" />
            <circle cx="15" cy="14" r="1" fill="currentColor" />
            <path d="M12 8V5.5" />
            <circle cx="12" cy="4" r="1.2" />
          </svg>
        </span>
        <div>
          <p class="text-sm font-semibold text-text-main">导演助手</p>
          <p class="text-[11px] text-text-muted">对话式管理角色、话题、世界观与关系</p>
        </div>
      </div>
      <button
        type="button"
        aria-label="关闭"
        class="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-main"
        @click="open = false"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- 消息流 -->
    <div ref="scrollRef" class="flex-1 space-y-2.5 overflow-y-auto bg-bg-card/60 px-4 py-3">
      <!-- 空态 -->
      <div v-if="!hasChat" class="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
        <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-bg-hover text-text-dim">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="8" width="16" height="12" rx="2" />
            <circle cx="9" cy="14" r="1" fill="currentColor" />
            <circle cx="15" cy="14" r="1" fill="currentColor" />
            <path d="M12 8V5.5" />
            <circle cx="12" cy="4" r="1.2" />
          </svg>
        </span>
        <p class="text-sm text-text-dim">你好，我是导演助手。</p>
        <p class="text-xs leading-5 text-text-muted">
          可以直接让我创建 / 修改 / 删除角色、话题、世界观模板，
          以及设置角色之间的关系——改动会立即同步到资产库。
        </p>
        <div class="mt-1 flex w-full flex-col gap-1.5">
          <button
            v-for="ex in EXAMPLES"
            :key="ex"
            type="button"
            class="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-left text-xs text-text-dim transition-colors hover:border-focus/50 hover:text-text-main"
            @click="fillExample(ex)"
          >
            {{ ex }}
          </button>
        </div>
      </div>

      <template v-for="item in items" :key="item.uid">
        <!-- 工具行 -->
        <div v-if="item.kind === 'tool'" class="overflow-hidden rounded-lg border border-border-subtle bg-white">
          <button
            type="button"
            class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-bg-hover"
            @click="item.expanded = !item.expanded"
          >
            <span
              v-if="item.status === 'running'"
              class="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-text-muted border-t-transparent"
            />
            <span v-else-if="item.status === 'ok'" class="shrink-0 text-ok">✓</span>
            <span v-else class="shrink-0 text-danger">✕</span>
            <span class="min-w-0 flex-1 truncate text-text-dim">{{ item.summary }}</span>
            <span
              v-if="item.mutated"
              class="shrink-0 rounded-full bg-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-ok"
              >已改资产</span
            >
            <span class="shrink-0 text-text-muted transition-transform" :class="item.expanded ? 'rotate-90' : ''">▸</span>
          </button>
          <div v-if="item.expanded" class="border-t border-border-subtle bg-bg-card px-2.5 py-2">
            <p class="mb-1 text-[10px] text-text-muted">工具：{{ item.name }}</p>
            <pre class="max-h-32 overflow-auto rounded bg-white p-1.5 text-[11px] leading-4 text-text-dim">{{ JSON.stringify(item.args, null, 2) }}</pre>
            <p v-if="item.detail" class="mt-1.5 whitespace-pre-wrap text-[11px] leading-4" :class="item.status === 'fail' ? 'text-danger' : 'text-text-dim'">{{ item.detail }}</p>
          </div>
        </div>

        <!-- 用户气泡 -->
        <div v-else-if="item.kind === 'user'" class="flex justify-end">
          <div class="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3 py-1.5 text-sm text-white">{{ item.content }}</div>
        </div>

        <!-- 系统提示条 -->
        <div v-else-if="item.kind === 'system'" class="flex justify-center">
          <span
            class="rounded-full px-3 py-1 text-center text-[11px] leading-4"
            :class="item.error ? 'bg-danger/10 text-danger' : 'bg-bg-hover text-text-muted'"
            >{{ item.content }}</span
          >
        </div>

        <!-- 助手气泡 -->
        <div v-else class="flex justify-start">
          <div class="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-border-subtle bg-white px-3 py-1.5 text-sm leading-6 text-text-main">
            {{ item.content
            }}<span
              v-if="streaming && items[items.length - 1] === item"
              class="ml-0.5 inline-block animate-blink text-text-muted"
              >▍</span
            >
          </div>
        </div>
      </template>
    </div>

    <!-- 输入区 -->
    <div class="shrink-0 border-t border-border-subtle bg-white px-3 pb-3 pt-2">
      <p v-if="sendError" class="mb-1.5 text-xs text-danger">{{ sendError }}</p>
      <textarea
        ref="inputRef"
        v-model="input"
        rows="2"
        placeholder="告诉我要做什么，例如：帮我建一个角色……"
        class="w-full resize-none rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-main outline-none placeholder:text-text-muted focus:border-focus focus:ring-1 focus:ring-focus"
        @keydown="onInputKeydown"
      />
      <div class="mt-1.5 flex items-center gap-1.5">
        <select
          v-model="providerId"
          class="min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-card px-2 py-1.5 text-xs text-text-main outline-none focus:border-focus"
          aria-label="模型"
        >
          <option value="" disabled>选择模型</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ providerLabel(p.id) }}</option>
        </select>
        <select
          v-if="thinkingSupported && thinkingOpts.length > 0"
          v-model="thinking"
          class="w-24 shrink-0 rounded-md border border-border-subtle bg-bg-card px-2 py-1.5 text-xs text-text-main outline-none focus:border-focus"
          aria-label="思考强度"
        >
          <option value="">思考:默认</option>
          <option v-for="o in thinkingOpts" :key="o.key" :value="o.key">{{ o.label }}</option>
        </select>
        <span v-else-if="thinkingLoading" class="shrink-0 text-[10px] text-text-muted">思考选项…</span>
        <button
          v-if="streaming"
          type="button"
          class="shrink-0 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          @click="stop"
        >
          停止
        </button>
        <button
          v-else
          type="button"
          :disabled="!canSend"
          class="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          @click="send()"
        >
          发送
        </button>
      </div>
      <p v-if="providers.length === 0" class="mt-1 text-[10px] text-text-muted">
        还没有可用的模型连接，先在「设置 → Provider」里添加一个。
      </p>
    </div>
  </div>
</template>
