import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 项目根目录（server/ 的上一级）
const projectRoot = path.resolve(__dirname, '..', '..')

dotenv.config({ path: path.join(projectRoot, '.env') })

function toInt(v, def) {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

function toFloat(v, def) {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : def
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3000),
  projectRoot,
  // DeepSeek
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 30000),
  // 全局硬熔断
  absoluteMaxRounds: toInt(process.env.ABSOLUTE_MAX_ROUNDS, 200),
  absoluteMaxDurationSec: toInt(process.env.ABSOLUTE_MAX_DURATION_SEC, 7200),
  // 成本估算（美元/百万 token，参考价）
  costInputPerMTok: toFloat(process.env.COST_INPUT_PER_MTOK, 0.27),
  costOutputPerMTok: toFloat(process.env.COST_OUTPUT_PER_MTOK, 1.10),
  // 数据目录
  dataDir: path.join(projectRoot, 'data', 'sessions'),
  // 前端构建产物（生产模式托管）
  staticDir: path.join(__dirname, '..', 'public'),
}

/**
 * fail-fast 校验：生产模式必须配置 API Key
 * dev 模式下若缺失仅警告（允许先跑骨架）
 */
export function validateConfig() {
  const errors = []
  if (!config.deepseekApiKey) {
    if (config.env === 'production') {
      errors.push('DEEPSEEK_API_KEY 未配置（请在 .env 中设置）')
    } else {
      console.warn('[config] 警告：DEEPSEEK_API_KEY 未配置，AI 调用将失败。请在 .env 中设置。')
    }
  }
  if (config.port < 0 || config.port > 65535) {
    errors.push(`PORT 非法: ${config.port}`)
  }
  if (errors.length > 0) {
    console.error('[config] 启动校验失败：')
    for (const e of errors) console.error('  - ' + e)
    process.exit(1)
  }
  return config
}

export default config
