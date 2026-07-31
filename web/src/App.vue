<script setup lang="ts">
/**
 * 应用根布局
 *
 * 三段式：顶栏（AppHeader）+ 主体（会话列表侧栏 + RouterView）+ 全局模态（NewChatModal / SettingsModal）。
 *
 * - 侧栏从「新建对话表单」改为「会话历史列表」（SessionSidebar）；
 * - 新建对话由顶栏「新建」按钮触发，打开 NewChatModal 模态；
 * - 设置（含 Provider / 智能体模板 / 话题模板 / 历史预设）由顶栏齿轮触发 SettingsModal；
 * - 会话工作区交给路由 SessionView，WS 在其内部管理。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { useSessionsStore } from '@/stores/sessions'
import { useFormStore } from '@/stores/form'
import { useDraftStore } from '@/stores/draft'
import { useConfigStore } from '@/stores/config'
import { useProviderStore } from '@/stores/provider'
import { useBreakpoint } from '@/composables/useBreakpoint'
import AppHeader from '@/components/AppHeader.vue'
import SessionSidebar from '@/components/SessionSidebar.vue'
import NewChatModal from '@/components/NewChatModal.vue'
import SettingsModal from '@/components/SettingsModal.vue'

const route = useRoute()
const session = useSessionStore()
const sessions = useSessionsStore()
const form = useFormStore()
const draft = useDraftStore()
const config = useConfigStore()
const provider = useProviderStore()

const { isMobile } = useBreakpoint()

/** 平板/桌面端：侧栏是否收起（内联模式） */
const sidebarCollapsed = ref(false)
/** 手机端：抽屉是否展开（覆盖模式） */
const drawerOpen = ref(false)
/** 新建对话模态 */
const showNewChat = ref(false)
/** 综合设置模态 */
const showSettings = ref(false)

/** 当前会话 id（路由派生） */
const currentSessionId = computed(() =>
  route.name === 'session' ? (route.params.id as string) : null,
)

/** 切换侧栏：手机走抽屉开关，平板/桌面走内联收起 */
function toggleSidebar() {
  if (isMobile.value) drawerOpen.value = !drawerOpen.value
  else sidebarCollapsed.value = !sidebarCollapsed.value
}

/** 离开手机断点时关闭抽屉，避免放大窗口后抽屉残留 */
watch(isMobile, (mobile) => {
  if (!mobile) drawerOpen.value = false
})

/** 路由变化时：同步侧栏 currentId、关闭抽屉 */
watch(currentSessionId, (id) => {
  sessions.currentId = id
  drawerOpen.value = false
})

/** 打开新建对话模态前，确保 Provider 已加载（新建表单依赖它） */
function openNewChat() {
  showNewChat.value = true
}

/** 草稿自动保存：监听表单字段变化，防抖存盘 */
watch(
  () => ({ ...form.values }),
  (vals) => draft.scheduleSave(vals),
  { deep: true },
)

/* --------------------------- 生命周期 --------------------------- */

onMounted(async () => {
  // 全局限制、Provider、会话列表
  await Promise.all([config.load(), provider.load(), sessions.load()])
  // 恢复草稿（供 NewChatModal 使用）
  const saved = draft.readDraft()
  if (saved) form.replace(saved)
  // 同步当前会话 id
  sessions.currentId = currentSessionId.value
})

// storeToRefs 仅用于解构响应式引用（此处暂未用到，保留 import 以备扩展）
void storeToRefs
</script>

<template>
  <div class="flex h-full flex-col">
    <AppHeader
      @toggle-sidebar="toggleSidebar"
      @new-chat="openNewChat"
      @open-settings="showSettings = true"
    />

    <main class="relative flex min-h-0 flex-1">
      <!-- 会话列表侧栏 -->
      <SessionSidebar
        :collapsed="sidebarCollapsed"
        :is-mobile="isMobile"
        :drawer-open="drawerOpen"
        @new-chat="openNewChat"
      />

      <!-- 手机端抽屉遮罩 -->
      <div
        v-if="isMobile && drawerOpen"
        class="fixed inset-0 z-30 bg-black/50 lg:hidden"
        @click="drawerOpen = false"
      />

      <!-- 主区：路由视图（HomeView / SessionView） -->
      <router-view />
    </main>

    <!-- 新建对话模态 -->
    <NewChatModal v-if="showNewChat" @close="showNewChat = false" />

    <!-- 综合设置模态 -->
    <SettingsModal v-if="showSettings" @close="showSettings = false" />

    <!-- 隐藏引用：session store 供模板外的逻辑共享 -->
    <span hidden>{{ session.session?.id }}</span>
  </div>
</template>
