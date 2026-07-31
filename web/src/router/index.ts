/**
 * 路由配置
 *
 * 两个视图：
 * - /                 首页（无会话时的空态 + 引导）
 * - /sessions/:id     会话工作区（聊天区，按 :id 加载）
 *
 * 用 createWebHistory：每个会话有独立 URL，刷新 / 前进后退都能恢复。
 * 后端 SPA fallback（server/src/index.ts）已把非 API/WS 的 GET 回退到 index.html。
 */
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/sessions/:id',
      name: 'session',
      component: () => import('@/views/SessionView.vue'),
      props: true,
    },
    // 兜底：未知路径回到首页
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
