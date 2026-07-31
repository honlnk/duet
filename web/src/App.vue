<script setup lang="ts">
/**
 * 应用根布局（纯横向三栏）
 *
 * 结构（参照 gpt-image-studio StudioShell / NovAI ProjectView）：
 *   <div flex h-full>
 *     ├─ <SessionSidebar>          左：深色会话列表（左上角 logo+设置+新建）
 *     ├─ <router-view>             中：上下结构（各 View 自带 header + 内容）
 *     └─ (SessionInspector 由 SessionView 内部挂载为右栏)
 *
 * 侧栏开关状态（sidebarCollapsed / drawerOpen）已迁入 session store，
 * 各 View 的 header 按钮跨 router-view 边界共享同一份状态。
 * 新建对话 / 设置 由左侧栏触发，在此打开模态。
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
const { sidebarCollapsed, drawerOpen } = storeToRefs(session)

/** 新建对话模态 */
const showNewChat = ref(false)
/** 综合设置模态 */
const showSettings = ref(false)

/** 当前会话 id（路由派生） */
const currentSessionId = computed(() =>
  route.name === 'session' ? (route.params.id as string) : null,
)

/** 路由变化时：同步侧栏 currentId、关闭抽屉 */
watch(currentSessionId, (id) => {
  sessions.currentId = id
  drawerOpen.value = false
})

/** 离开手机断点时关闭抽屉，避免放大窗口后抽屉残留 */
watch(isMobile, (mobile) => {
  if (!mobile) drawerOpen.value = false
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
</script>

<template>
  <div class="flex h-full">
    <!-- 会话列表侧栏 -->
    <SessionSidebar
      :collapsed="sidebarCollapsed"
      :is-mobile="isMobile"
      :drawer-open="drawerOpen"
      @new-chat="openNewChat"
      @open-settings="showSettings = true"
    />

    <!-- 手机端抽屉遮罩 -->
    <div
      v-if="isMobile && drawerOpen"
      class="fixed inset-0 z-30 bg-black/50 lg:hidden"
      @click="drawerOpen = false"
    />

    <!-- 主区：路由视图（HomeView / SessionView，各自含 header） -->
    <router-view @new-chat="openNewChat" />

    <!-- 新建对话模态 -->
    <NewChatModal v-if="showNewChat" @close="showNewChat = false" />

    <!-- 综合设置模态 -->
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
  </div>
</template>
