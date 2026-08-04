import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import config from '../config.js'
import { AgentMemory } from '../memory/context.js'
import { estimateStepCost, round6 } from '../utils/cost.js'
import type { CostRates } from '../utils/cost.js'
import { convertCurrency } from '../utils/currency.js'
import { DEFAULT_AGENT_COLORS, agentColorOf } from '../ai/prompts.js'
import type {
  AgentId,
  AgentRef,
  CreateSessionInput,
  Session,
  SessionConfig,
  SessionListItem,
  SessionStats,
} from '../types/index.js'
import type { NormalizedUsage } from '../ai/providers/types.js'

/** 会话允许的智能体数量区间 */
export const MIN_AGENTS = 2
export const MAX_AGENTS = 10

/**
 * 把 AgentId 与其在 agents 数组中的索引互转。
 * A→0, B→1, ..., J→9。
 */
export const AGENT_ORDER: readonly AgentId[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
]

/** AgentId → 索引 */
export function agentIndex(id: AgentId): number {
  return AGENT_ORDER.indexOf(id)
}

/** 索引 → AgentId */
export function agentIdAt(index: number): AgentId {
  return AGENT_ORDER[index] ?? 'A'
}

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

/**
 * 创建新会话对象。
 * 支持 2~3 个智能体：agents[0/1/2] 对应 A/B/C。
 * 颜色缺省时按 A/B/C 顺序分配默认色（蓝/粉/绿），避免相邻智能体撞色。
 */
export function createSession({ topic, agents, config: cfg }: CreateSessionInput): Session {
  const now = Date.now()
  // 规范化智能体列表：补 id/name/persona/color，截断到 MAX_AGENTS。
  // 过滤掉可能存在的 undefined（三元组第三个元素可选），保证 map 元素非空。
  const inputs = agents.slice(0, MAX_AGENTS).filter(
    (a): a is NonNullable<typeof a> => a != null,
  )
  const refs: AgentRef[] = inputs.map((a, i) => ({
    id: agentIdAt(i),
    name: a.name?.trim() || `智能体 ${agentIdAt(i)}`,
    persona: a.persona?.trim() || '',
    color: (a.color?.trim() as AgentRef['color']) || DEFAULT_AGENT_COLORS[i % DEFAULT_AGENT_COLORS.length] || 'blue',
  }))

  // 每个智能体的「其他人」列表（排除自己）
  const othersOf = (selfIdx: number): AgentRef[] =>
    refs.filter((_, i) => i !== selfIdx)

  // 为每个智能体构建独立记忆（动态，支持 2~10 个）
  const memory = {} as Session['memory']
  refs.forEach((ref, i) => {
    memory[ref.id] = new AgentMemory(ref, othersOf(i), topic).toJSON()
  })

  const session: Session = {
    id: 'sess_' + randomUUID(),
    topic,
    agents: refs,
    config: defaultConfig(cfg),
    status: 'idle',
    finishedReason: null,
    startedAt: null,
    stoppedAt: null,
    messageCount: 0,
    currentAgentId: 'A',
    messages: [],
    memory,
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

/** 读取单个会话（含旧数据兼容归一化） */
export function loadSession(id: string): Session | null {
  const file = path.join(config.dataDir, `${id}.json`)
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8')
  try {
    const s = JSON.parse(raw) as Session
    normalizeLegacySession(s)
    return s
  } catch (e) {
    console.error('[store] 会话文件损坏:', id, e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * 旧数据归一化（向后兼容）：
 * 1. memory.X 旧字段 `other`（单个 AgentRef）→ `others`（数组）。
 * 2. agents 缺 color → 按索引补默认色。
 * 3. agents 第二项 id 校正为 'B'（旧数据恒为 [A,B]，无需改）。
 * 不写盘，仅修正内存对象；下次 saveSession 时自然持久化为新格式。
 */
function normalizeLegacySession(s: Session): void {
  if (Array.isArray(s.agents)) {
    s.agents.forEach((a, i) => {
      if (!a.color) a.color = DEFAULT_AGENT_COLORS[i % DEFAULT_AGENT_COLORS.length] || 'blue'
    })
  }
  for (const key of ['A', 'B', 'C'] as const) {
    const m = s.memory?.[key]
    if (!m) continue
    // 旧格式：other（单个）→ others（数组）
    if (!Array.isArray(m.others)) {
      const legacyOther = (m as { other?: AgentRef }).other
      m.others = legacyOther ? [legacyOther] : []
      delete (m as { other?: AgentRef }).other
    }
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
 * @param rates       该次调用所用 Provider 的完整单价（含缓存维度）
 * @param displayCurrency  展示货币代码（成本统一折算到此币种）
 * @param exchangeRates    各货币对 USD 的汇率表（用于跨币种换算）
 */
export function addStats(
  session: Session,
  usage: NormalizedUsage,
  rates: CostRates,
  displayCurrency: string,
  exchangeRates: Record<string, number>,
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
  // 展示货币固定（会话启动时选举得出）
  session.stats.costCurrency = displayCurrency
  // 先按本币算出本次成本，再折算到展示货币后累加（避免跨币种裸加）
  const stepCostLocal = estimateStepCost(usage, rates)
  const stepCostDisplay = convertCurrency(
    stepCostLocal, exchangeRates, rates.currency || displayCurrency, displayCurrency,
  )
  session.stats.estCost = round6(session.stats.estCost + stepCostDisplay)
  return session.stats
}

/**
 * 计算当前 round。
 * 1 round = 所有智能体各发言一次（2 人场景 = 2 条 message/轮，3 人场景 = 3 条/轮）。
 */
export function currentRound(session: Session): number {
  const n = session.agents.length || MIN_AGENTS
  return Math.floor(session.messageCount / n)
}

/**
 * 计算会话的下一个发言者：按 A→B→C→A… 的固定顺序循环。
 */
export function nextAgentId(session: Session): AgentId {
  const n = session.agents.length
  const curIdx = agentIndex(session.currentAgentId)
  const nextIdx = (curIdx + 1) % n
  return session.agents[nextIdx]?.id ?? 'A'
}
