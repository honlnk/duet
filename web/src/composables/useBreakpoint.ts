/**
 * useBreakpoint —— 响应式断点 composable
 *
 * 跟踪当前视口是否处于手机宽度（< md = 768px），用于决定侧栏走
 * 「抽屉覆盖式」还是「内联并排」布局。
 *
 * 实现要点：
 * - setup 阶段立即初始化 isMobile（带 SSR/无 window 守卫），避免首帧闪烁。
 * - onMounted 挂载 matchMedia 的 change 监听，onBeforeUnmount 清理。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const MOBILE_MAX = 767

export function useBreakpoint() {
  const isMobile = ref(false)

  function syncFromMedia(mql: MediaQueryList) {
    isMobile.value = mql.matches
  }

  let mql: MediaQueryList | null = null
  function onChange(e: MediaQueryListEvent) {
    isMobile.value = e.matches
  }

  // setup 阶段同步初始化，避免首屏渲染时 isMobile=false（桌面态）造成闪烁
  if (typeof window !== 'undefined' && window.matchMedia) {
    mql = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`)
    syncFromMedia(mql)
  }

  onMounted(() => {
    if (!mql && typeof window !== 'undefined' && window.matchMedia) {
      mql = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`)
      syncFromMedia(mql)
    }
    mql?.addEventListener('change', onChange)
  })

  onBeforeUnmount(() => {
    mql?.removeEventListener('change', onChange)
  })

  return { isMobile }
}
