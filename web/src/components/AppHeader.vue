<script setup lang="ts">
import StatsBar from './StatsBar.vue'
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle bg-bg-soft px-4"
  >
    <!-- 品牌 -->
    <div class="flex items-baseline gap-2">
      <span class="text-xl text-accent">♪</span>
      <span class="text-lg font-semibold text-text-main">Duet</span>
      <span class="hidden text-xs text-text-muted sm:inline"
        >双 AI 对话聊天室</span
      >
    </div>
    <!-- 状态栏 -->
    <StatsBar />
  </header>
</template>
