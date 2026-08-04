<script setup lang="ts">
/**
 * 综合设置中心（居中模态，左侧 tab 导航 + 右侧内容区）
 *
 * 四个 tab：
 *  1. Provider —— 内嵌 ProviderPanel（embedded 模式，多协议模型连接管理）
 *  2. 智能体模板 —— 可复用的 persona 模板，供新建对话点选；含「新建会话」快速入口
 *  3. 话题模板 —— 常用话题
 *  4. 历史预设 —— 历史表单预设管理
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import ProviderPanel from './ProviderPanel.vue'
import { useDraftStore } from '@/stores/draft'
import { useFormStore } from '@/stores/form'
import { useTemplateStore } from '@/stores/template'
import { labelOf } from '@/services/storage'

const emit = defineEmits<{ close: [] }>()

type Tab = 'provider' | 'agent' | 'topic' | 'history'
const tab = ref<Tab>('provider')

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'provider', label: 'API 配置' },
  { key: 'agent', label: '智能体模板' },
  { key: 'topic', label: '话题模板' },
  { key: 'history', label: '历史预设' },
]

/** 点遮罩关闭（防误触：按下和松开都在遮罩才关） */
let mouseDownOnOverlay = false
function onOverlayMouseDown() {
  mouseDownOnOverlay = true
}
function onOverlayClick(e: MouseEvent) {
  if (mouseDownOnOverlay && e.target === e.currentTarget) emit('close')
  mouseDownOnOverlay = false
}

/* --------------------------- 模板（store 统一管理） --------------------------- */
const template = useTemplateStore()
const { agents: agentTemplates, topics: topicTemplates } = storeToRefs(template)

/* --------------------------- 智能体模板 tab --------------------------- */
const agentDraft = ref({ name: '', persona: '' })

function addAgent() {
  if (!agentDraft.value.name.trim() && !agentDraft.value.persona.trim()) return
  template.addAgent(agentDraft.value.name, agentDraft.value.persona)
  agentDraft.value = { name: '', persona: '' }
}

function delAgent(id: string) {
  template.removeAgent(id)
}

/** 智能体模板 tab 的「新建会话」快速入口：发信号给 App 打开新建对话 */
function startNewChat() {
  template.requestNewChat()
}

/* --------------------------- 话题模板 tab --------------------------- */
const topicDraft = ref('')

function addTopic() {
  if (!topicDraft.value.trim()) return
  template.addTopic(topicDraft.value)
  topicDraft.value = ''
}

function delTopic(id: string) {
  template.removeTopic(id)
}

/* --------------------------- 历史预设 tab --------------------------- */
const draft = useDraftStore()
const form = useFormStore()
const { history } = storeToRefs(draft)
const selectedHistoryId = ref('')

function loadHistory() {
  const item = history.value.find((h) => h.id === selectedHistoryId.value)
  if (item) form.replace(item.values)
}

function clearHistoryAll() {
  draft.clearHistory()
  selectedHistoryId.value = ''
}

const hasHistory = computed(() => history.value.length > 0)
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
      class="flex h-[min(88vh,44rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
    >
      <!-- header：标题 + 当前分类标签 + 关闭 -->
      <header
        class="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-4"
      >
        <div class="flex items-center gap-2.5">
          <h2 class="text-base font-semibold text-text-main">设置</h2>
          <span class="text-text-muted">/</span>
          <span class="text-sm text-text-dim">
            {{ tabs.find((t) => t.key === tab)?.label }}
          </span>
        </div>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-main"
          aria-label="关闭"
          @click="emit('close')"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <!-- 主体：左 tab 导航 + 右内容 -->
      <div class="flex min-h-0 flex-1">
        <!-- 左：tab 导航 -->
        <nav class="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border-subtle bg-bg-card p-2">
          <button
            v-for="t in tabs"
            :key="t.key"
            type="button"
            class="rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors"
            :class="tab === t.key
              ? 'bg-bg-hover text-text-main'
              : 'text-text-dim hover:bg-bg-hover hover:text-text-main'"
            @click="tab = t.key"
          >
            {{ t.label }}
          </button>
        </nav>

        <!-- 右：内容区（可滚动） -->
        <div class="min-h-0 flex-1 overflow-y-auto">
          <!-- Provider tab：内嵌 ProviderPanel -->
          <div v-if="tab === 'provider'" class="h-full">
            <ProviderPanel embedded />
          </div>

          <!-- 智能体模板 tab -->
          <div v-else-if="tab === 'agent'" class="flex flex-col gap-4 p-5">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs text-text-dim">
                保存常用的智能体身份设定，新建对话时直接点选使用。
              </p>
              <!-- 新建会话快速入口 -->
              <button
                type="button"
                class="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                :disabled="agentTemplates.length < 2"
                :title="agentTemplates.length < 2 ? '至少需要 2 个智能体模板' : ''"
                @click="startNewChat"
              >
                + 新建会话
              </button>
            </div>
            <!-- 新增表单 -->
            <div class="flex flex-col gap-2 rounded-lg border border-border-subtle bg-bg-card p-3">
              <input
                v-model="agentDraft.name"
                type="text"
                placeholder="名称（如：苏格拉底）"
                class="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-focus focus:ring-1 focus:ring-focus"
              />
              <textarea
                v-model="agentDraft.persona"
                rows="2"
                placeholder="身份设定（你是谁、你的立场…）"
                class="w-full resize-y rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-focus focus:ring-1 focus:ring-focus"
              />
              <button
                type="button"
                class="self-start rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                :disabled="!agentDraft.name.trim() && !agentDraft.persona.trim()"
                @click="addAgent"
              >
                + 添加模板
              </button>
            </div>
            <!-- 模板列表 -->
            <div v-if="agentTemplates.length === 0" class="py-6 text-center text-xs text-text-muted">
              还没有模板
            </div>
            <div v-else class="flex flex-col gap-2">
              <div
                v-for="t in agentTemplates"
                :key="t.id"
                class="group flex items-start justify-between gap-3 rounded-lg border border-border-subtle bg-white px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-text-main">
                    {{ t.name || '（未命名）' }}
                  </p>
                  <p class="mt-0.5 line-clamp-2 text-xs text-text-dim">{{ t.persona }}</p>
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded-md px-2 py-1 text-xs text-text-muted hover:bg-danger/10 hover:text-danger"
                  @click="delAgent(t.id)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>

          <!-- 话题模板 tab -->
          <div v-else-if="tab === 'topic'" class="flex flex-col gap-4 p-5">
            <p class="text-xs text-text-dim">
              保存常用话题，新建对话时点选使用。
            </p>
            <div class="flex gap-2">
              <input
                v-model="topicDraft"
                type="text"
                placeholder="输入话题后回车或点添加"
                class="min-w-0 flex-1 rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-focus focus:ring-1 focus:ring-focus"
                @keydown.enter="addTopic"
              />
              <button
                type="button"
                class="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                :disabled="!topicDraft.trim()"
                @click="addTopic"
              >
                + 添加
              </button>
            </div>
            <div v-if="topicTemplates.length === 0" class="py-6 text-center text-xs text-text-muted">
              还没有话题模板
            </div>
            <div v-else class="flex flex-col gap-2">
              <div
                v-for="t in topicTemplates"
                :key="t.id"
                class="group flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-white px-3 py-2"
              >
                <span class="min-w-0 flex-1 truncate text-sm text-text-main">{{ t.content }}</span>
                <button
                  type="button"
                  class="shrink-0 rounded-md px-2 py-1 text-xs text-text-muted hover:bg-danger/10 hover:text-danger"
                  @click="delTopic(t.id)"
                >
                  删除
                </button>
              </div>
            </div>
          </div>

          <!-- 历史预设 tab -->
          <div v-else class="flex flex-col gap-4 p-5">
            <p class="text-xs text-text-dim">
              历史预设记录每次「开始对话」时的完整配置，可一键加载到表单。
            </p>
            <div v-if="!hasHistory" class="py-6 text-center text-xs text-text-muted">
              还没有历史预设
            </div>
            <div v-else class="flex flex-col gap-2">
              <div
                v-for="h in history"
                :key="h.id"
                class="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-white px-3 py-2"
                :class="selectedHistoryId === h.id && 'border-focus ring-1 ring-focus'"
                @click="selectedHistoryId = h.id"
              >
                <span class="min-w-0 flex-1 truncate text-sm text-text-main">
                  {{ labelOf(h.values) }}
                </span>
                <button
                  type="button"
                  class="shrink-0 rounded-md border border-border-subtle px-2 py-1 text-xs text-text-dim hover:bg-bg-hover"
                  :disabled="!selectedHistoryId || selectedHistoryId !== h.id"
                  @click.stop="loadHistory"
                >
                  加载
                </button>
              </div>
            </div>
            <button
              v-if="hasHistory"
              type="button"
              class="self-start rounded-md px-2 py-1 text-xs text-text-muted hover:text-danger"
              @click="clearHistoryAll"
            >
              清空全部历史
            </button>
          </div>
        </div>
      </div>

      <!-- footer：关闭按钮 -->
      <footer class="flex shrink-0 justify-end border-t border-border-subtle px-5 py-3">
        <button
          type="button"
          class="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          @click="emit('close')"
        >
          关闭
        </button>
      </footer>
    </div>
  </div>
</template>
