<script setup lang="ts">
import StatsBar from './StatsBar.vue'

defineEmits<{ 'toggle-sidebar': []; 'open-providers': [] }>()
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle bg-bg-soft px-3 md:px-4"
  >
    <!-- 左侧：汉堡菜单（手机+平板可见）+ 品牌 -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-text-dim hover:bg-bg-hover lg:hidden"
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
        <span class="text-xl text-accent">♪</span>
        <span class="text-lg font-semibold text-text-main">Duet</span>
        <span class="hidden text-xs text-text-muted sm:inline"
          >双 AI 对话聊天室</span
        >
      </div>

      <!-- Provider 管理入口 -->
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded-lg text-text-dim hover:bg-bg-hover hover:text-text-main"
        aria-label="Provider 管理"
        title="Provider 管理"
        @click="$emit('open-providers')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
    <!-- 状态栏 -->
    <StatsBar />
  </header>
</template>
