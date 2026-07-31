<script setup lang="ts">
/**
 * 首页视图（路由 /）
 *
 * 未选中任何会话时的空态：主区 header（侧栏 toggle + 品牌名）+ 居中引导。
 * 点击「新建对话」由父级 App.vue 打开 NewChatModal。
 */
import { storeToRefs } from 'pinia'
import { useSessionStore } from '@/stores/session'
import AppLogo from '@/components/AppLogo.vue'

defineEmits<{ 'new-chat': [] }>()

const session = useSessionStore()
const { sidebarCollapsed } = storeToRefs(session)
</script>

<template>
  <section class="flex min-w-0 flex-1 flex-col bg-bg">
    <!-- 主区 header（与会话页结构一致） -->
    <header
      class="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3"
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
          <svg v-if="sidebarCollapsed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
          <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
        <h1 class="truncate text-base font-semibold text-text-main">Duet</h1>
      </div>
      <!-- 右侧占位（保持与 SessionView header 对称） -->
      <div class="flex items-center gap-1">
        <span class="w-9" />
      </div>
    </header>

    <!-- 空态引导 -->
    <div class="flex flex-1 items-center justify-center px-6">
      <div class="flex max-w-md flex-col items-center text-center">
        <!-- 品牌标识 -->
        <div
          class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-soft text-white shadow-sm"
        >
          <AppLogo :size="40" />
        </div>
        <h2 class="text-lg font-semibold text-text-main">Duet · 多智能体自主对话</h2>
        <p class="mt-2 text-sm leading-relaxed text-text-dim">
          给多个 AI 一个话题与身份，让它们自主对话。<br />
          从左侧选择历史会话，或新建一段对话开始。
        </p>

        <button
          type="button"
          class="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
          @click="$emit('new-chat')"
        >
          + 新建对话
        </button>

        <p class="mt-8 text-xs text-text-muted">
          在左侧「设置」中管理 Provider、智能体模板与话题模板。
        </p>
      </div>
    </div>
  </section>
</template>
