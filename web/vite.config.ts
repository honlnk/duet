import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 构建产物直接输出到后端静态目录，单进程托管
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: false,
    // 开发态：前端跑在 5174，把 /api、/ws 反代到后端 3000。
    // 业务代码用相对路径 + location.host，无需感知端口差异。
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
