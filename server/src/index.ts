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
import wsRoutes from './ws/wsRoutes.js'
import {
  recoverSessions,
  loadSession,
  saveSession,
  listSessions,
} from './store/sessionStore.js'

/**
 * 启动服务器（单端口托管前端 + REST + WS）。
 * dev 模式下若已有构建产物则直接托管；prod 模式用 @fastify/static。
 */
export async function buildServer(): Promise<FastifyInstance> {
  validateConfig()

  // 崩溃恢复
  const recovered = recoverSessions()
  if (recovered > 0) {
    console.log(`[startup] 恢复 ${recovered} 个崩溃会话（running → stopped）`)
  }

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
  await fastify.register(wsRoutes)

  // 静态托管前端
  await registerStaticOrVite(fastify)

  return fastify
}

async function registerStaticOrVite(fastify: FastifyInstance): Promise<void> {
  const staticDir = config.staticDir
  const indexHtml = path.join(staticDir, 'index.html')
  const hasBuild = fs.existsSync(indexHtml)

  if (config.env === 'production' && hasBuild) {
    // 生产：托管构建产物
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
    return
  }

  if (hasBuild) {
    // dev 但已有构建产物：直接托管（无需 vite）
    await fastify.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
    })
    fastify.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.sendFile('index.html')
      }
      reply.code(404).send({ error: 'Not Found' })
    })
    return
  }

  // dev 且无构建产物：内联极简首页（提示先 build 或直接用前端 dev）
  fastify.get('/', async () => ({
    message:
      '前端尚未构建。请运行 `pnpm build` 后再启动，或在 web/ 目录单独 `pnpm dev`。',
  }))
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
  try {
    spawn(cmd, [...baseArgs, url], { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* 忽略，仅打印 URL */
  }
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
    console.log(`  环境: ${config.env}  模型: ${config.deepseekModel}`)
    console.log(`  熔断: ≤ ${config.absoluteMaxRounds} 轮 / ${config.absoluteMaxDurationSec}s`)
    console.log('═══════════════════════════════════════')
    if (config.env !== 'production') {
      openBrowser(displayUrl)
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

// 仅作为入口时执行（兼容 tsx 跑 .ts 与 node 跑 dist/.js）
const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main()
}
