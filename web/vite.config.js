import { defineConfig } from 'vite'

// 前端构建产物输出到 server/public，由 Fastify @fastify/static 托管。
// dev 模式下通过 server/src/index.js 内的 viteDevServer 中间件挂载，单端口访问。
export default defineConfig({
  root: '.',
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    // dev 时由后端反代，端口统一为后端端口；此处仅占位
    port: 5174,
    strictPort: false,
  },
})
