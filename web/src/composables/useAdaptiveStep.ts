/**
 * useAdaptiveStep —— 自适应步长 composable
 *
 * 用于价格等数字输入框的上下按钮：
 * 连续快速点击时自动升级步长，停下来恢复默认，调大数值更高效。
 *
 * 规则（以普通字段为例，base=0.01）：
 * - 默认步长 0.01
 * - 短时间内连续同方向点击 3+ 次 → 升级到 0.1
 * - 短时间内连续同方向点击 5+ 次 → 升级到 1
 * - 停顿超过阈值（默认 600ms）→ 回到默认步长
 *
 * 缓存命中等小数字字段用更小的 base（如 0.001），阶梯同理：0.001 → 0.01 → 0.1
 *
 * 用法：
 *   const { step, onStep } = useAdaptiveStep(0.01)
 *   // 点击 + 按钮：onStep(currentValue, +1) → 返回新值
 *   // step 是响应式，绑定到展示
 */
import { ref } from 'vue'

/** 阈值配置 */
const RAPID_INTERVAL_MS = 600 // 两次点击间隔小于此值视为「连续快速点击」
const TIER_2_COUNT = 3 // 连续 3 次升级到第二档
const TIER_3_COUNT = 5 // 连续 5 次升级到第三档

export function useAdaptiveStep(base: number) {
  // 三档步长：base、base×10、base×100
  const tiers = [base, base * 10, base * 100]
  const tierIndex = ref(0)
  /** 连续同方向点击次数（正/负代表方向） */
  let consecutive = 0
  let lastDir = 0
  let lastTime = 0

  /** 当前生效步长（响应式） */
  const step = ref(base)

  /** 根据连续点击次数刷新档位 */
  function refreshTier() {
    const count = Math.abs(consecutive)
    let idx = 0
    if (count >= TIER_3_COUNT) idx = 2
    else if (count >= TIER_2_COUNT) idx = 1
    if (idx !== tierIndex.value) {
      tierIndex.value = idx
      step.value = tiers[idx]!
    }
  }

  /**
   * 执行一次步进，返回新值。
   *
   * 步进规则：
   * - 在同档位内连续点击：累加当前步长
   * - 刚升级到新档位时：把值吸附到新步长的整数倍（递增往上取整、递减往下取整），
   *   避免停在 0.97 这种尴尬值，直接对齐到 1.0
   *
   * @param current 当前值
   * @param dir     方向：+1 增加 / -1 减少
   * @returns 步进后的新值
   */
  function onStep(current: number, dir: 1 | -1): number {
    const now = Date.now()
    const elapsed = now - lastTime
    // 方向变化或停顿过久 → 重置计数（但保留当前档位一次，避免来回切档抖动）
    if (dir !== lastDir || elapsed > RAPID_INTERVAL_MS) {
      consecutive = 1
    } else {
      consecutive += 1
    }
    lastDir = dir
    lastTime = now

    const prevTier = tierIndex.value
    refreshTier()
    const newTier = tierIndex.value
    const curStep = step.value

    let next: number
    if (newTier > prevTier) {
      // 档位刚升级：吸附到新步长的整数倍（递增向上取整、递减向下取整）
      next = snapToMultiple(current, curStep, dir)
    } else {
      // 同档位正常累加
      next = current + dir * curStep
    }
    // 不允许负数
    return next < 0 ? 0 : Math.round(next * 1e6) / 1e6
  }

  /**
   * 把值吸附到 step 的整数倍。
   * 递增（dir=+1）向上取整到下一个整数倍，递减（dir=-1）向下取整到上一个整数倍。
   * 例：snap(0.97, 1, +1) = 1，snap(0.94, 0.1, +1) = 1.0，snap(1.02, 1, -1) = 1
   */
  function snapToMultiple(value: number, stepSize: number, dir: 1 | -1): number {
    const ratio = value / stepSize
    const aligned = dir > 0 ? Math.ceil(ratio) : Math.floor(ratio)
    return Math.round(aligned * stepSize * 1e6) / 1e6
  }

  return { step, onStep }
}
