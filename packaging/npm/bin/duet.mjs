#!/usr/bin/env node
/**
 * @honlnk/duet 启动器（npm 薄壳）。
 *
 * 本包不含任何运行时代码——真正的程序是随包分发的 Python wheel（dist/*.whl，
 * 内含 FastAPI 后端与打包好的前端页面）。此脚本只做一件事：
 * 用 uv 以 `uvx --from <wheel> duet-langgraph` 运行它。
 *
 * 为什么经 uv：uv 会自动准备 >=3.12 的 Python 解释器与依赖环境，
 * 用户机器无需预装 Python；数据落盘 ~/.duet（安装形态判定见后端 config.py）。
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// 1. 找随包分发的 wheel（发布时由 CI 放入 dist/）
const distDir = join(pkgRoot, 'dist')
let wheel = null
try {
  wheel = readdirSync(distDir).find((f) => /^duet_langgraph-.*\.whl$/.test(f))
} catch {
  /* dist/ 缺失 */
}
if (!wheel) {
  console.error('错误：包内缺少 Python wheel（dist/duet_langgraph-*.whl）。')
  console.error('这是打包损坏，请重新安装：npm i -g @honlnk/duet')
  process.exit(1)
}
const wheelPath = join(distDir, wheel)

// 2. 检查 uv（唯一前置；它会自动管理 Python 版本）
const probe = spawnSync('uv', ['--version'], { stdio: 'ignore' })
if (probe.error || probe.status !== 0) {
  console.error('duet 需要 uv（Python 运行环境管理器）来运行，未检测到 uv。')
  console.error('')
  console.error('  macOS / Linux:  brew install uv')
  console.error('                 curl -LsSf https://astral.sh/uv/install.sh | sh')
  console.error('  Windows:        powershell -c "irm https://astral.sh/uv/install.ps1 | iex"')
  console.error('')
  console.error('安装 uv 后重试即可；后续运行无需任何 Python 操作。')
  process.exit(1)
}

// 3. 运行：uvx --from <wheel>（同版本 wheel 的环境会被 uv 缓存，二次启动秒级）
//    stdio 直通保留流式日志；信号转发由 uv/uvicorn 自身处理。
const result = spawnSync('uv', ['tool', 'run', '--from', wheelPath, 'duet-langgraph'], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
