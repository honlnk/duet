<script setup lang="ts">
import StatsBar from './StatsBar.vue'

defineEmits<{ 'toggle-sidebar': [] }>()
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
    </div>
    <!-- 状态栏 -->
    <StatsBar />
  </header>
</template>
