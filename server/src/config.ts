import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from './types/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 项目根目录（server/ 的上一级）
const projectRoot = path.resolve(__dirname, '..', '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })

/**
 * 推断运行环境：
 * - 显式设置 NODE_ENV 时，尊重它（开发用 cross-env / 测试用环境变量）
 * - 未设置时：跑的是编译产物（dist/*.js）默认生产（终端用户 npx / docker / node dist 场景），
 *   跑的是源码（src/*.ts via tsx）默认开发
 */
function detectEnv(): string {
  if (process.env.NODE_ENV) return process.env.NODE_ENV
  // 编译产物恒在名为 dist 的目录下（源码开发时是 src）
  const runningFromDist = path.basename(__dirname) === 'dist'
  return runningFromDist ? 'production' : 'development'
}

function toInt(v: string | undefined, def: number): number {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) ? n : def
}

const config: AppConfig = {
  env: detectEnv(),
  port: toInt(process.env.PORT, 3000),
  projectRoot,
  requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 30000),
  // 全局硬熔断
  absoluteMaxRounds: toInt(process.env.ABSOLUTE_MAX_ROUNDS, 200),
  absoluteMaxDurationSec: toInt(process.env.ABSOLUTE_MAX_DURATION_SEC, 7200),
  // 数据目录：优先用 DATA_DIR 环境变量（npm 包 / Docker 场景下指向持久化目录），
  // 否则回退到项目根的 data/sessions（开发 / 源码部署）
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(projectRoot, 'data', 'sessions'),
  // Provider 配置：与 sessions/ 平级，放 data/ 根目录
  // DATA_DIR 已指向 sessions 子目录，providers.json 应与其同级而非在其内部
  providersFile:
    process.env.DATA_DIR
      ? path.join(path.dirname(path.resolve(process.env.DATA_DIR)), 'providers.json')
      : path.join(projectRoot, 'data', 'providers.json'),
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
