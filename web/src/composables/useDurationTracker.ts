/**
 * useDurationTracker —— 对话计时器 composable
 *
 * 每秒更新显示文本：
 * - 设了 durationSec：显示「剩余 Xm XXs」倒计时。
 * - 未设（无限）：显示「已运行 Xm XXs」正计时。
 *
 * 注意：startedAt / durationSec 必须用 ref 存储，display computed 才能
 * 正确追踪依赖；若用闭包变量（普通 let），computed 无法感知其变化。
 */
import { computed, ref } from 'vue'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function useDurationTracker() {
  const now = ref(Date.now())
  /** 会话开始时间戳（响应式，供 computed 依赖） */
  const startedAt = ref(0)
  /** 持续时间上限秒数（0 = 无限，正计时） */
  const durationSec = ref(0)
  /** 计时器是否激活 */
  let timer: ReturnType<typeof setInterval> | null = null

  function start(beginAt: number, duration: number) {
    startedAt.value = beginAt
    durationSec.value = duration
    now.value = Date.now()
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  }

  /**
   * 停止计时。
   * @param freezeAt 冻结展示的时刻（如会话真实结束时间 stoppedAt）；
   *                 不传则保留 now 最后值。终态下传入可避免展示漂移。
   */
  function stop(freezeAt?: number) {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (freezeAt) now.value = freezeAt
  }

  /** 当前展示文本 */
  const display = computed(() => {
    if (!startedAt.value) return '0s'
    const elapsed = Math.max(
      0,
      Math.floor((now.value - startedAt.value) / 1000),
    )
    if (durationSec.value > 0) {
      const remain = Math.max(0, durationSec.value - elapsed)
      const m = Math.floor(remain / 60)
      const s = remain % 60
      return `剩余 ${m}m ${pad(s)}s`
    }
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    return `已运行 ${m}m ${pad(s)}s`
  })

  return { display, start, stop }
}
