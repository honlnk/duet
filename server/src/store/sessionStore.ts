import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import config from '../config.js'
import { AgentMemory } from '../memory/context.js'
import { estimateStepCost, round6 } from '../utils/cost.js'
import type { CostRates } from '../utils/cost.js'
import type {
  CreateSessionInput,
  DeepSeekUsage,
  Session,
  SessionConfig,
  SessionListItem,
  SessionStats,
} from '../types/index.js'

/** 默认会话配置 */
export function defaultConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    maxRounds: 0,
    durationSec: 0,
    // model 仅为向后兼容保留；实际模型由 Provider 配置决定
    model: 'deepseek-v4-flash',
    temperature: 0.7,
    summaryEveryN: 10,
    keepRecent: 8,
    ...overrides,
  }
}

/** 创建新会话对象 */
export function createSession({ topic, agents, config: cfg }: CreateSessionInput): Session {
  const now = Date.now()
  const a = agents[0]
  const b = agents[1]
  const session: Session = {
    id: 'sess_' + randomUUID(),
    topic,
    agents: [
      { id: 'A', name: a.name || 'A', persona: a.persona || '' },
      { id: 'B', name: b.name || 'B', persona: b.persona || '' },
    ],
    config: defaultConfig(cfg),
    status: 'idle',
    finishedReason: null,
    startedAt: null,
    stoppedAt: null,
    messageCount: 0,
    currentAgentId: 'A',
    messages: [],
    memory: {
      A: new AgentMemory(
        { id: 'A', name: a.name || 'A', persona: a.persona || '' },
        { id: 'B', name: b.name || 'B', persona: b.persona || '' },
        topic
      ).toJSON(),
      B: new AgentMemory(
        { id: 'B', name: b.name || 'B', persona: b.persona || '' },
        { id: 'A', name: a.name || 'A', persona: a.persona || '' },
        topic
      ).toJSON(),
    },
    stats: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCacheHitTokens: 0,
      totalCacheMissTokens: 0,
      totalCacheWriteTokens: 0,
      estCost: 0,
      costCurrency: '',
      totalChars: 0,
    },
    error: null,
    createdAt: now,
    updatedAt: now,
  }
  return session
}

/** 把会话写入磁盘（同步，每条 message_done 后调用） */
export function saveSession(session: Session): void {
  session.updatedAt = Date.now()
  const dir = config.dataDir
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${session.id}.json`)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), 'utf8')
  fs.renameSync(tmp, file) // 原子替换
}

/** 读取单个会话 */
export function loadSession(id: string): Session | null {
  const file = path.join(config.dataDir, `${id}.json`)
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8')
  try {
    return JSON.parse(raw) as Session
  } catch (e) {
    console.error('[store] 会话文件损坏:', id, e instanceof Error ? e.message : e)
    return null
  }
}

/** 列出所有会话（按 updatedAt 倒序） */
export function listSessions(): SessionListItem[] {
  const dir = config.dataDir
  if (!fs.existsSync(dir)) return []
  const out: SessionListItem[] = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const raw = fs.readFileSync(path.join(dir, f), 'utf8')
    try {
      const s = JSON.parse(raw) as Session
      out.push({
        id: s.id,
        topic: s.topic,
        status: s.status,
        messageCount: s.messageCount,
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
        agents: s.agents?.map((a) => a.name) ?? [],
      })
    } catch {
      // 损坏文件跳过
    }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt)
  return out
}

/** 删除会话 */
export function deleteSession(id: string): boolean {
  const file = path.join(config.dataDir, `${id}.json`)
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    return true
  }
  return false
}

/**
 * 启动恢复：把所有 status==="running" 的会话改为 stopped。
 * 崩溃后重启调用，避免僵尸会话。
 */
export function recoverSessions(): number {
  const dir = config.dataDir
  if (!fs.existsSync(dir)) return 0
  let n = 0
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const p = path.join(dir, f)
    let s: Session
    try {
      s = JSON.parse(fs.readFileSync(p, 'utf8')) as Session
    } catch {
      continue
    }
    if (s.status === 'running') {
      s.status = 'stopped'
      s.finishedReason = s.finishedReason || 'crashed'
      s.updatedAt = Date.now()
      fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf8')
      n++
    }
  }
  return n
}

/**
 * 累加 token 统计 + 增量累加成本。
 *
 * 成本按「单次调用用量 × 该次 Provider 单价」增量累加，
 * 从根本上修复旧实现「按累计 token × 最新 rate 重算全量」在混合多 Provider 会话中的偏差。
 *
 * @param session 当前会话
 * @param usage 该次调用返回的 usage（含缓存拆分字段）
 * @param rates 该次调用所用 Provider 的完整单价（含缓存维度）
 */
export function addStats(
  session: Session,
  usage: DeepSeekUsage,
  rates: CostRates
): SessionStats {
  const pt = usage.prompt_tokens || 0
  const ct = usage.completion_tokens || 0
  const hit = usage.prompt_cache_hit_tokens || 0
  const miss = usage.prompt_cache_miss_tokens || 0
  const write = usage.prompt_cache_write_tokens || 0

  session.stats.totalPromptTokens += pt
  session.stats.totalCompletionTokens += ct
  session.stats.totalCacheHitTokens += hit
  session.stats.totalCacheMissTokens += miss
  session.stats.totalCacheWriteTokens += write
  session.stats.totalTokens =
    session.stats.totalPromptTokens + session.stats.totalCompletionTokens
  // 记录货币（取首个调用方 / 后续以实际为准），供前端展示符号
  session.stats.costCurrency = rates.currency || session.stats.costCurrency
  // 增量累加成本，不再重算全量
  session.stats.estCost = round6(session.stats.estCost + estimateStepCost(usage, rates))
  return session.stats
}

/** 计算当前 round（1 round = A+B 两条 message） */
export function currentRound(session: Session): number {
  return Math.floor(session.messageCount / 2)
}
