import dotenv from 'dotenv'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from './types/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 项目根目录（server/ 的上一级）
const projectRoot = path.resolve(__dirname, '..', '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })

// 编译产物恒在名为 dist 的目录下（源码开发时是 src）
const runningFromDist = path.basename(__dirname) === 'dist'

/**
 * 推断运行环境：
 * - 显式设置 NODE_ENV 时，尊重它（开发用 cross-env / 测试用环境变量）
 * - 未设置时：跑的是编译产物（dist/*.js）默认生产（终端用户 npx / docker / node dist 场景），
 *   跑的是源码（src/*.ts via tsx）默认开发
 */
function detectEnv(): string {
  if (process.env.NODE_ENV) return process.env.NODE_ENV
  return runningFromDist ? 'production' : 'development'
}

/**
 * 数据根目录：sessions/ providers.json/ library.json 均在其下。
 * - DATA_DIR 环境变量最优先
 * - 未设置且跑的是编译产物（npx / 全局安装）：~/.duet —— 写用户主目录，
 *   避免落进 npx 缓存（缓存被清即丢配置）
 * - 未设置且为源码开发：项目根 data/
 */
const dataRoot = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : runningFromDist
    ? path.join(os.homedir(), '.duet')
    : path.join(projectRoot, 'data')

function toInt(v: string | undefined, def: number): number {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? n : def
}

const config: AppConfig = {
  env: detectEnv(),
  port: toInt(process.env.PORT, 23892),
  projectRoot,
  requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 30000),
  // 全局硬熔断
  absoluteMaxRounds: toInt(process.env.ABSOLUTE_MAX_ROUNDS, 200),
  absoluteMaxDurationSec: toInt(process.env.ABSOLUTE_MAX_DURATION_SEC, 7200),
  // 会话数据目录（dataRoot/sessions）
  dataDir: path.join(dataRoot, 'sessions'),
  // Provider 配置：数据根目录下，与 sessions/ 平级
  providersFile: path.join(dataRoot, 'providers.json'),
  // 资产库（角色/话题/世界观模板 + 关系）：与 providers.json 同目录
  libraryFile: path.join(dataRoot, 'library.json'),
  // 前端构建产物（生产模式托管）
  staticDir: path.join(__dirname, '..', 'public'),
}

/**
 * fail-fast 校验：端口合法性
 * （Provider 配置的校验由 providerStore.validateProviders 负责）
 */
export function validateConfig(): AppConfig {
  if (config.port < 0 || config.port > 65535) {
    console.error(`[config] 启动校验失败：PORT 非法: ${config.port}`)
    process.exit(1)
  }
  return config
}

export default config
