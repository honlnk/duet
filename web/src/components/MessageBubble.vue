<script setup lang="ts">
import { computed } from 'vue'
import type { ViewMessage } from '@/stores/session'
import { useSessionStore } from '@/stores/session'
import {
  textColor,
  borderLColor,
  borderRColor,
  colorStyle,
  resolveColor,
} from '@/utils/agentColor'

const props = defineProps<{ message: ViewMessage }>()

const session = useSessionStore()

const agent = computed(() => session.findAgent(props.message.agentId))
/** 该消息的智能体在 agents 数组中的索引（用于回退默认色） */
const agentIndex = computed(() => {
  const idx = session.session?.agents.findIndex((a) => a.id === props.message.agentId)
  return idx ?? 0
})
const color = computed(() => resolveColor(agent.value?.color, agentIndex.value))
const name = computed(() => session.agentName(props.message.agentId))

/** 是否靠右显示：当前视角智能体的消息靠右，其余靠左 */
const isRight = computed(() => session.isRightSide(props.message.agentId))

/** 气泡对齐 */
const wrapperClass = computed(() =>
  isRight.value ? 'self-end items-end' : 'self-start items-start',
)
/** 侧边强调条：预设→class，自定义→class+inline */
const accent = computed(() =>
  isRight.value ? borderRColor(color.value) : borderLColor(color.value),
)
/** 流式光标 + 名字标签颜色 */
const nameColor = computed(() => textColor(color.value))
/** 自定义色时注入根 CSS 变量（供子元素 var() 引用） */
const rootStyle = computed(() => colorStyle(color.value))
</script>

<template>
  <div class="flex w-full flex-col gap-1" :class="wrapperClass" :style="rootStyle">
    <span
      class="px-2 text-xs font-medium"
      :class="nameColor.class"
      :style="nameColor.style"
    >
      {{ name }}
    </span>
    <div
      class="max-w-[85%] rounded-xl bg-bg-card px-3 py-2 text-text-main whitespace-pre-wrap break-words md:max-w-[72%]"
      :class="[
        accent.class,
        message.truncated && 'opacity-60 border border-dashed border-border-subtle',
      ]"
      :style="accent.style"
    >
      <span>{{ message.content }}</span>
      <!-- 流式光标 -->
      <span
        v-if="message.streaming"
        class="ml-0.5 inline-block w-[7px] animate-blink"
        :class="nameColor.class"
        :style="nameColor.style"
        >▋</span
      >
      <span
        v-if="message.truncated"
        class="ml-2 text-xs text-warn"
        >[已截断]</span
      >
    </div>
  </div>
</template>
