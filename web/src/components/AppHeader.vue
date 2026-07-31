<script setup lang="ts">
/**
 * 顶栏
 *
 * 深色（#171717，bg-bg-soft），三段式布局：
 *  - 左：汉堡菜单（移动端切换侧栏抽屉）+ 品牌标识
 *  - 右：「新建对话」按钮 + 设置按钮
 *
 * 运行统计（StatsBar）放在会话工作区的亮色控制条中，避免在深底上对比度不足。
 *
 * 事件：toggle-sidebar（移动端）、new-chat（打开新建模态）、open-settings（打开设置中心）。
 */
defineEmits<{
  'toggle-sidebar': []
  'new-chat': []
  'open-settings': []
}>()
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-bg-soft px-3 text-gray-100 md:px-4"
  >
    <!-- 左：汉堡 + 品牌 -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-gray-100 lg:hidden"
        aria-label="切换侧栏"
        @click="$emit('toggle-sidebar')"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="3" y1="5" x2="17" y2="5" />
          <line x1="3" y1="10" x2="17" y2="10" />
          <line x1="3" y1="15" x2="17" y2="15" />
        </svg>
      </button>
      <div class="flex items-baseline gap-2">
        <span class="text-xl text-white">♪</span>
        <span class="text-lg font-semibold text-white">Duet</span>
        <span class="hidden text-xs text-gray-400 sm:inline">双 AI 对话聊天室</span>
      </div>
    </div>

    <!-- 右：新建 + 设置 -->
    <div class="flex items-center gap-2 md:gap-3">
      <!-- 新建对话 -->
      <button
        type="button"
        class="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-200"
        @click="$emit('new-chat')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span class="hidden sm:inline">新建对话</span>
      </button>

      <!-- 设置 -->
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-gray-100"
        aria-label="设置"
        title="设置"
        @click="$emit('open-settings')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  </header>
</template>
