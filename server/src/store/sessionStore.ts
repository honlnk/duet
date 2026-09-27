import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import config from '../config.js'
import { CharacterMemory } from '../memory/context.js'
import { estimateStepCost, round6 } from '../utils/cost.js'
import type { CostRates } from '../utils/cost.js'
import { convertCurrency } from '../utils/currency.js'
import { DEFAULT_CHARACTER_COLORS, characterColorOf } from '../ai/prompts.js'
import type {
  CharacterId,
  CharacterRef,
  CreateSessionInput,
  Session,
  SessionConfig,
  SessionListItem,
  SessionStats,
} from '../types/index.js'
import type { NormalizedUsage } from '../ai/providers/types.js'

/** 会话允许的角色数量区间 */
export const MIN_CHARACTERS = 2
export const MAX_CHARACTERS = 10

/**
 * 把 CharacterId 与其在 characters 数组中的索引互转。
 * A→0, B→1, ..., J→9。
 */
export const CHARACTER_ORDER: readonly CharacterId[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
]

/** CharacterId → 索引 */
export function characterIndex(id: CharacterId): number {
  return CHARACTER_ORDER.indexOf(id)
}

/** 索引 → CharacterId */
export function characterIdAt(index: number): CharacterId {
  return CHARACTER_ORDER[index] ?? 'A'
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
    pacingEnabled: true,
    pacingBufferRounds: 2,
    ...overrides,
  }
}

/**
 * 创建新会话对象。
 * 支持 2~3 个角色：characters[0/1/2] 对应 A/B/C。
 * 颜色缺省时按 A/B/C 顺序分配默认色（蓝/粉/绿），避免相邻角色撞色。
 */
export function createSession({ topic, characters, config: cfg, relationships }: CreateSessionInput): Session {
  const now = Date.now()
  // 规范化角色列表：补 id/name/description/personality/color，截断到 MAX_CHARACTERS。
  const inputs = characters.slice(0, MAX_CHARACTERS).filter(
    (a): a is NonNullable<typeof a> => a != null,
  )
  const refs: CharacterRef[] = inputs.map((a, i) => ({
    id: characterIdAt(i),
    name: a.name?.trim() || `角色 ${characterIdAt(i)}`,
    description: a.description?.trim() || undefined,
    personality: a.personality?.trim() || undefined,
    color: (a.color?.trim() as CharacterRef['color']) || DEFAULT_CHARACTER_COLORS[i % DEFAULT_CHARACTER_COLORS.length] || 'blue',
  }))

  // 每个角色的「其他人」列表（排除自己）
  const othersOf = (selfIdx: number): CharacterRef[] =>
    refs.filter((_, i) => i !== selfIdx)

  // 为每个角色构建独立记忆（动态，支持 2~10 个）
  const memory = {} as Session['memory']
  refs.forEach((ref, i) => {
    memory[ref.id] = new CharacterMemory(ref, othersOf(i), topic, relationships).toJSON()
  })

  const session: Session = {
    id: 'sess_' + randomUUID(),
    topic,
    characters: refs,
    config: defaultConfig(cfg),
    status: 'idle',
    finishedReason: null,
    startedAt: null,
    stoppedAt: null,
    messageCount: 0,
    currentCharacterId: 'A',
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
    relationships: relationships || {},
    directors: [],
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

/**
 * 旧版会话文件归一化（「智能体」概念时期写入的持久化数据）：
 * - 顶层 agents → characters
 * - currentAgentId → currentCharacterId
 * - messages[].agentId → characterId
 * 读取时转为新结构，下次落盘即写入新格式。
 */
function normalizeLegacySession(raw: unknown): Session {
  const s = raw as Record<string, unknown>
  if (!s || typeof s !== 'object') return raw as Session
  if (Array.isArray(s.agents) && !s.characters) {
    s.characters = s.agents
    delete s.agents
  }
  if (typeof s.currentAgentId === 'string') {
    s.currentCharacterId = s.currentAgentId
    delete s.currentAgentId
  }
  const cfg = s.config as Record<string, unknown> | undefined
  if (cfg && typeof cfg === 'object') {
    if (cfg.agentProviders && !cfg.characterProviders) {
      cfg.characterProviders = cfg.agentProviders
      delete cfg.agentProviders
    }
    if (cfg.agentThinking && !cfg.characterThinking) {
      cfg.characterThinking = cfg.agentThinking
      delete cfg.agentThinking
    }
  }
  if (Array.isArray(s.messages)) {
    for (const m of s.messages as Array<Record<string, unknown>>) {
      if (m && typeof m.agentId === 'string') {
        m.characterId = m.agentId
        delete m.agentId
      }
    }
  }
  return raw as Session
}

/** 读取单个会话 */
export function loadSession(id: string): Session | null {
  const file = path.join(config.dataDir, `${id}.json`)
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8')
  try {
    return normalizeLegacySession(JSON.parse(raw))
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
      const s = normalizeLegacySession(JSON.parse(raw))
      out.push({
        id: s.id,
        topic: s.topic,
        status: s.status,
        messageCount: s.messageCount,
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
        characters: s.characters?.map((a) => a.name) ?? [],
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
      s = normalizeLegacySession(JSON.parse(fs.readFileSync(p, 'utf8')))
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
 * 1 round = 所有角色各发言一次（2 人场景 = 2 条 message/轮，3 人场景 = 3 条/轮）。
 */
export function currentRound(session: Session): number {
  const n = session.characters.length || MIN_CHARACTERS
  return Math.floor(session.messageCount / n)
}

/**
 * 计算会话的下一个发言者：按 A→B→C→A… 的固定顺序循环。
 */
export function nextCharacterId(session: Session): CharacterId {
  const n = session.characters.length
  const curIdx = characterIndex(session.currentCharacterId)
  const nextIdx = (curIdx + 1) % n
  return session.characters[nextIdx]?.id ?? 'A'
}
