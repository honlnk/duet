#!/usr/bin/env node
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import config, { validateConfig } from './config.js'
import healthRoutes from './routes/health.js'
import sessionRoutes from './routes/sessions.js'
import providerRoutes from './routes/providers.js'
import pricingRoutes from './routes/pricing.js'
import exchangeRoutes from './routes/exchange.js'
import wsRoutes from './ws/wsRoutes.js'
import {
  recoverSessions,
  loadSession,
  saveSession,
  listSessions,
} from './store/sessionStore.js'
import { validateProviders } from './store/providerStore.js'

/**
 * 启动服务器。
 * 生产模式：单进程托管前端构建产物 + REST + WS。
 * 开发模式：仅提供 REST + WS，前端由 vite 独立托管。
 */
export async function buildServer(): Promise<FastifyInstance> {
  validateConfig()

  // 崩溃恢复
  const recovered = recoverSessions()
  if (recovered > 0) {
    console.log(`[startup] 恢复 ${recovered} 个崩溃会话（running → stopped）`)
  }

  // Provider 校验（确认至少有一条可用）
  validateProviders()

  const fastify = Fastify({
    logger: config.env === 'production' ? { level: 'info' } : { level: 'warn' },
  })
  fastify.decorate('config', config)

  // WebSocket
  await fastify.register(fastifyWebsocket, {
    options: { maxPayload: 1024 * 1024 },
  })

  // REST 路由
  await fastify.register(healthRoutes)
  await fastify.register(sessionRoutes)
  await fastify.register(providerRoutes)
  await fastify.register(pricingRoutes)
  await fastify.register(exchangeRoutes)
  await fastify.register(wsRoutes)

  // 静态托管前端
  await registerStaticOrVite(fastify)

  return fastify
}

async function registerStaticOrVite(fastify: FastifyInstance): Promise<void> {
  // 开发：后端仅提供 API/WS，前端由 vite 独立托管（默认 http://localhost:5174）
  if (config.env !== 'production') {
    fastify.get('/', async () => ({
      message: '后端运行于开发模式，仅提供 API/WebSocket。前端请访问 vite dev server。',
    }))
    return
  }

  // 生产：托管前端构建产物（server/public）
  const staticDir = config.staticDir
  const indexHtml = path.join(staticDir, 'index.html')
  if (!fs.existsSync(indexHtml)) {
    fastify.get('/', async () => ({
      error:
        '前端尚未构建，生产模式无法托管。请先运行 `pnpm build`。',
    }))
    return
  }

  await fastify.register(fastifyStatic, {
    root: staticDir,
    prefix: '/',
  })
  // SPA fallback
  fastify.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
      return reply.sendFile('index.html')
    }
    reply.code(404).send({ error: 'Not Found' })
  })
}

/** 各平台的「打开浏览器」命令 */
const browserCmds: Partial<Record<NodeJS.Platform, readonly [string, string[]]>> = {
  darwin: ['open', []],
  win32: ['cmd', ['/c', 'start']],
  linux: ['xdg-open', []],
}

function openBrowser(url: string): void {
  const entry = browserCmds[process.platform as NodeJS.Platform]
  if (!entry) return
  const [cmd, baseArgs] = entry
  // spawn 的 ENOENT 等错误是异步经 'error' 事件抛出的，同步 try/catch 接不住。
  // 无图形环境（Docker / 远程服务器 / headless）下打开命令不存在，静默忽略即可，
  // 避免未监听的 'error' 事件把进程拖崩。
  const child = spawn(cmd, [...baseArgs, url], { stdio: 'ignore', detached: true })
  child.on('error', () => {
    /* 无可用浏览器或命令缺失，忽略 */
  })
  child.unref()
}

async function main(): Promise<void> {
  const fastify = await buildServer()
  try {
    // PORT=0 时自动分配可用端口
    const address = await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    })
    const displayUrl = address.replace('0.0.0.0', 'localhost')
    console.log('═══════════════════════════════════════')
    console.log(`  Duet 已启动`)
    console.log(`  本地访问: ${displayUrl}`)
    console.log(`  环境: ${config.env}`)
    console.log(`  熔断: ≤ ${config.absoluteMaxRounds} 轮 / ${config.absoluteMaxDurationSec}s`)
    console.log('═══════════════════════════════════════')

    // 生产模式：后端托管前端，自动打开浏览器。
    // 开发模式：后端仅提供 API/WS，前端由 vite 独立托管，不碰页面。
    if (config.env === 'production') {
      openBrowser(displayUrl)
    } else {
      console.log(
        '  ℹ️  开发模式：后端仅提供 API/WS，前端请访问 vite dev server（默认 http://localhost:5174）。',
      )
    }
  } catch (e) {
    fastify.log.error(e)
    process.exit(1)
  }

  // graceful shutdown
  const shutdown = async (sig: string): Promise<void> => {
    console.log(`\n[shutdown] 收到 ${sig}，正在保存会话…`)
    try {
      // 把所有 running 会话标记 stopped 并 flush
      for (const s of listSessions()) {
        const full = loadSession(s.id)
        if (full && full.status === 'running') {
          full.status = 'stopped'
          full.finishedReason = full.finishedReason || 'shutdown'
          full.stoppedAt = Date.now()
          saveSession(full)
          console.log(`[shutdown] 会话 ${s.id} 已保存为 stopped`)
        }
      }
      await fastify.close()
      console.log('[shutdown] 完成')
      process.exit(0)
    } catch (e) {
      console.error('[shutdown] 异常', e)
      process.exit(1)
    }
  }
  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

// 仅作为入口时执行。
// 用 realpath 比较，兼容全局安装的软链接（process.argv[1] 是 bin 软链接路径，
// import.meta.url 是其指向的真实 dist/index.js，直接 === 会不等）。
const isMain = (() => {
  const argvPath = process.argv[1]
  if (!argvPath) return false
  const modulePath = fileURLToPath(import.meta.url)
  try {
    return fs.realpathSync(argvPath) === fs.realpathSync(modulePath)
  } catch {
    return argvPath === modulePath
  }
})()
if (isMain) {
  main().catch((e) => {
    console.error('[fatal] 启动失败', e)
    process.exit(1)
  })
}
