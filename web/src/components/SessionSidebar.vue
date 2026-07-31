<script setup lang="ts">
/**
 * 会话历史侧栏（深色 #171717）
 *
 * 取代旧版「新建对话表单侧栏」。结构参考 gpt-image-studio ConversationSidebar：
 *  - 左上角品牌区：logo 图标 + 主副标题 + 设置按钮（齿轮）
 *  - 新建会话按钮（整行，半透明底）
 *  - 搜索框：按话题/智能体名过滤
 *  - 列表：SessionListItem，点击路由跳转，hover 可删除
 *
 * 响应式：移动端抽屉（fixed 滑入），桌面内联（w-65）。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionsStore } from '@/stores/sessions'
import SessionListItem from './SessionListItem.vue'
import AppLogo from './AppLogo.vue'

const props = defineProps<{
  /** 平板/桌面：侧栏是否收起（内联模式） */
  collapsed: boolean
  /** 当前是否为手机断点 */
  isMobile: boolean
  /** 手机端：抽屉是否展开（覆盖模式） */
  drawerOpen: boolean
}>()

const emit = defineEmits<{
  'new-chat': []
  'open-settings': []
}>()

const router = useRouter()
const sessions = useSessionsStore()
const { sorted, currentId, loading } = storeToRefs(sessions)

const keyword = ref('')

/** 按关键词过滤（话题 / 智能体名） */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return sorted.value
  return sorted.value.filter((s) => {
    const hay = (s.topic + ' ' + s.agents.join(' ')).toLowerCase()
    return hay.includes(kw)
  })
})

/** 侧栏类名派生 */
const asideClass = computed(() => {
  if (props.isMobile) {
    return [
      'bg-sidebar-scroll fixed inset-y-0 left-0 z-40 flex w-[85%] max-w-[340px] flex-col bg-bg-soft shadow-xl transition-transform duration-200',
      props.drawerOpen ? 'translate-x-0' : '-translate-x-full',
    ]
  }
  return [
    'bg-sidebar-scroll flex flex-col border-r border-white/10 bg-bg-soft transition-all duration-200',
    props.collapsed ? 'w-0 overflow-hidden border-r-0' : 'w-65',
  ]
})

/** 跳转到指定会话 */
function navigate(id: string) {
  router.push(`/sessions/${id}`)
}

/** 删除会话：从列表移除；若删的是当前会话，回到首页 */
async function removeSession(id: string) {
  try {
    await sessions.remove(id)
    if (id === currentId.value) router.push('/')
  } catch {
    /* 删除失败静默（列表会在下次 refresh 时校正） */
  }
}
</script>

<template>
  <aside :class="asideClass">
    <!-- 左上角品牌区：logo + 主副标题 + 设置 -->
    <div class="flex shrink-0 items-center justify-between px-3 pb-1 pt-3">
      <div class="flex min-w-0 items-center gap-2 px-2 py-2">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
          <AppLogo :size="20" />
        </span>
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-white">Duet</div>
          <div class="truncate text-xs text-gray-500">多智能体自主对话</div>
        </div>
      </div>
      <button
        type="button"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
        aria-label="打开设置"
        title="设置"
        @click="$emit('open-settings')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>

    <!-- 新建会话按钮（整行） -->
    <div class="shrink-0 px-3 pb-1 pt-2">
      <button
        type="button"
        class="flex w-full items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2.5 text-left text-sm font-medium text-gray-100 transition-colors hover:bg-white/20"
        @click="$emit('new-chat')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>新建会话</span>
      </button>
    </div>

    <!-- 搜索框 -->
    <div class="shrink-0 px-3 pb-2 pt-1">
      <div class="relative">
        <input
          v-model="keyword"
          type="text"
          placeholder="搜索会话…"
          class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-500 focus:border-white/20 focus:bg-white/10"
        />
        <button
          v-if="keyword"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-200"
          aria-label="清空搜索"
          @click="keyword = ''"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 列表 -->
    <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
      <!-- 加载中 -->
      <div v-if="loading && sorted.length === 0" class="px-3 py-8 text-center text-xs text-gray-500">
        加载中…
      </div>

      <!-- 空列表 -->
      <div
        v-else-if="filtered.length === 0"
        class="px-3 py-8 text-center text-xs text-gray-500"
      >
        {{ keyword ? '没有匹配的会话' : '还没有会话，点击「新建」开始' }}
      </div>

      <!-- 列表项 -->
      <SessionListItem
        v-for="s in filtered"
        :key="s.id"
        :summary="s"
        :active="s.id === currentId"
        @navigate="navigate"
        @remove="removeSession"
      />
    </div>

    <!-- footer：品牌署名 -->
    <div class="flex shrink-0 items-center gap-2 border-t border-white/10 p-3">
      <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/10 text-white">
        <AppLogo :size="13" />
      </span>
      <span class="text-xs text-gray-500">Duet · 多智能体对话 · honlnk</span>
    </div>
  </aside>
</template>
