<script setup lang="ts">
/**
 * 首页视图（路由 /）
 *
 * 未选中任何会话时的空态：品牌标识 + 引导文案 + 「新建对话」按钮。
 * 点击「新建对话」由父级 App.vue 打开 NewChatModal。
 */
defineEmits<{ 'new-chat': [] }>()
</script>

<template>
  <section class="flex min-w-0 flex-1 items-center justify-center bg-bg px-6">
    <div class="flex max-w-md flex-col items-center text-center">
      <!-- 品牌标识 -->
      <div
        class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-soft text-3xl text-white shadow-sm"
      >
        ♪
      </div>
      <h1 class="text-lg font-semibold text-text-main">Duet · 双 AI 对话聊天室</h1>
      <p class="mt-2 text-sm leading-relaxed text-text-dim">
        给两个 AI 一个话题与身份，让它们自己聊起来。<br />
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
        在「设置」中管理 Provider、智能体模板与话题模板。
      </p>
    </div>
  </section>
</template>
