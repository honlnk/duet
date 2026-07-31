<script setup lang="ts">
/**
 * 品牌 logo：双对话气泡交叠
 *
 * 表达「多 Agent 在同一聊天室自主对话」的核心定位——
 * 一前一后两个圆角气泡相互交叠，暗示多方参与、互相对话。
 * 两个气泡用当前颜色/透明度区分前后层次。
 */
withDefaults(defineProps<{
  /** 整体尺寸（正方形边长，px） */
  size?: number
}>(), {
  size: 32,
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <!-- 后方气泡（A）：略偏左上，半透明 -->
    <path
      d="M6 5.5h11.5a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-3.5 3.5H12l-4.5 3.8a1 1 0 0 1-1.6-.8V18.5H6A1.5 1.5 0 0 1 4.5 17V7A1.5 1.5 0 0 1 6 5.5z"
      fill="currentColor"
      fill-opacity="0.55"
    />
    <!-- 前方气泡（B）：略偏右下，实色 -->
    <path
      d="M14.5 12H26a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 26 25h-0.9v3.3a1 1 0 0 1-1.6.8L19 25h-4.5A1.5 1.5 0 0 1 12.5 23.5v-10A1.5 1.5 0 0 1 14.5 12z"
      fill="currentColor"
    />
  </svg>
</template>
