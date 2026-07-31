<script setup lang="ts">
/**
 * 会话历史侧栏（深色 #171717）
 *
 * 取代旧版「新建对话表单侧栏」。现在这里只展示会话历史列表：
 *  - 顶部：标题「会话」+ 「新建」按钮（触发父级打开 NewChatModal）
 *  - 搜索框：按话题/智能体名过滤
 *  - 列表：SessionListItem，点击路由跳转，hover 可删除
 *
 * 响应式：移动端抽屉（fixed 滑入），桌面内联（w-64 lg:w-80）。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionsStore } from '@/stores/sessions'
import SessionListItem from './SessionListItem.vue'

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
    props.collapsed ? 'w-0 overflow-hidden border-r-0' : 'w-64 lg:w-80',
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
    <!-- 头部：标题 + 新建按钮 -->
    <div class="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
      <span class="text-sm font-semibold text-gray-200">会话</span>
      <button
        type="button"
        class="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs font-medium text-gray-100 hover:bg-white/20"
        @click="$emit('new-chat')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新建
      </button>
    </div>

    <!-- 搜索框 -->
    <div class="shrink-0 px-3 pb-2">
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索会话…"
        class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-200 outline-none placeholder:text-gray-500 focus:border-white/20 focus:bg-white/10"
      />
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
  </aside>
</template>
