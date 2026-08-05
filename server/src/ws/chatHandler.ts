import { getAdapter } from '../ai/providers/index.js'
import type { ConnectionConfig } from '../types/index.js'
import type { NormalizedUsage } from '../ai/providers/types.js'
import type { CostRates } from '../utils/cost.js'
import {
  buildOpeningPrompt,
  wrapOtherMessage,
} from '../ai/prompts.js'
import { AgentMemory } from '../memory/context.js'
import { summarizeConversation } from '../memory/summarizer.js'
import {
  saveSession,
  addStats,
  currentRound,
  nextAgentId,
} from '../store/sessionStore.js'
import { resolveProvider } from '../store/providerStore.js'
import { pickDisplayCurrency, getRatesWithFallback } from '../utils/currency.js'
import config from '../config.js'
import type {
  AgentId,
  AgentRef,
  BroadcastFn,
  PersistedMessage,
  Session,
  SessionStatus,
  ServerToClientMsg,
} from '../types/index.js'

/** 单会话运行时状态（内存态，含当前 fetch 的 AbortController） */
interface Runtime {
  abortCtrl: AbortController | null
  wsClients: Set<BroadcastFn>
  running: boolean
  /** 用户请求停止标志（runLoop 每轮检查） */
  stopRequested: boolean
  /** runLoop 当前操作的 session 内存引用 */
  activeSession: Session | null
}

/**
 * 会话运行时状态（内存态，含当前 fetch 的 AbortController）。
 * key: sessionId
 */
const runtimes = new Map<string, Runtime>()

function getRuntime(sessionId: string): Runtime {
  let rt = runtimes.get(sessionId)
  if (!rt) {
    rt = {
      abortCtrl: null,
      wsClients: new Set(),
      running: false,
      stopRequested: false,
      activeSession: null,
    }
    runtimes.set(sessionId, rt)
  }
  return rt
}

/** 注册一个 WS 连接到会话 */
export function attachClient(sessionId: string, send: BroadcastFn): () => void {
  const rt = getRuntime(sessionId)
  rt.wsClients.add(send)
  return () => rt.wsClients.delete(send)
}

/**
 * 同步关系数据到正在运行的会话运行时状态。
 *
 * PATCH /api/sessions/:id/relationships 路由调用此函数，
 * 把新关系图同步到 runLoop 持有的内存态 Session + 各 AgentMemory，
 * 使「对话进行中修改关系 → 下一轮 prompt 更新」生效。
 *
 * 若该会话当前未运行（无 activeSession），则无操作（磁盘已由路由写盘）。
 */
export function syncRelationshipsToRuntime(
  sessionId: string,
  relationships: Record<string, string>,
): void {
  const rt = runtimes.get(sessionId)
  if (!rt || !rt.activeSession) return
  rt.activeSession.relationships = relationships
}

/** 向该会话所有 WS 客户端广播 */
function broadcast(sessionId: string, msg: ServerToClientMsg): void {
  const rt = runtimes.get(sessionId)
  if (!rt) return
  for (const send of rt.wsClients) {
    try {
      send(msg)
    } catch {
      // 单客户端发送失败不影响其它客户端
    }
  }
}

/** 用户主动停止：设置标志位 + 中断当前 fetch（runLoop 退出时统一发 finished） */
export function stopSession(sessionId: string): void {
  const rt = getRuntime(sessionId)
  rt.stopRequested = true
  // 同步操作 runLoop 当前持有的 session 引用（若有）
  if (rt.activeSession) {
    rt.activeSession.status = 'stopped'
    rt.activeSession.stoppedAt = Date.now()
    rt.activeSession.finishedReason = 'stopped'
    saveSession(rt.activeSession)
  }
  if (rt.abortCtrl) {
    try {
      rt.abortCtrl.abort()
    } catch {
      // abort 失败忽略
    }
  }
}

/** 判断是否为 abort 类型错误 */
function isAbortError(e: unknown, abortCtrl: AbortController | null): boolean {
  const errorAborted = e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message))
  return errorAborted || (abortCtrl?.signal.aborted ?? false)
}

/** 提取错误信息 */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** 每个 Agent 的连接配置 + 单价缓存（运行期一次性解析） */
interface AgentRuntime {
  id: AgentId
  ref: AgentRef
  mem: AgentMemory
  conn: ConnectionConfig
  rates: CostRates
  provName: string
}

/**
 * 主循环：让多个 AI 按固定顺序（A→B→C→A…）轮流自主对话。
 * @param session  会话对象（会被原地修改）
 */
export async function runLoop(session: Session): Promise<void> {
  const rt = getRuntime(session.id)

  // 防止重复 start
  if (rt.running) {
    broadcast(session.id, { type: 'error', message: '会话已在运行中' })
    return
  }
  if (!['idle', 'stopped', 'finished', 'error'].includes(session.status)) {
    broadcast(session.id, { type: 'error', message: `当前状态 ${session.status} 不可启动` })
    return
  }

  rt.running = true
  rt.stopRequested = false
  rt.activeSession = session
  session.status = 'running'
  session.error = null
  session.finishedReason = null
  if (!session.startedAt) session.startedAt = Date.now()
  saveSession(session)
  broadcast(session.id, { type: 'started' })

  // 把 JSON 形态的 memory 还原成 AgentMemory 实例（操作内存，结束时再写回）
  const memMap = new Map<AgentId, AgentMemory>()
  for (const a of session.agents) {
    const data = session.memory[a.id]
    const mem = data ? AgentMemory.fromJSON(data) : new AgentMemory(a, [], session.topic, session.relationships)
    // 确保运行期 relationships 与 session 级一致（PATCH 可能修改过）
    mem.relationships = session.relationships || {}
    memMap.set(a.id, mem)
  }

  // 为每个 Agent 解析 Provider 连接配置。
  // 优先 agentProviders[id]（D~J 等），其次 providerA/B/C（兼容旧字段），再次默认。
  const providerIdOf = (id: AgentId): string | undefined => {
    if (id === 'A') return session.config.providerA
    if (id === 'B') return session.config.providerB
    if (id === 'C') return session.config.providerC
    return session.config.agentProviders?.[id]
  }

  const runtimes2: AgentRuntime[] = []
  for (const a of session.agents) {
    const prov = resolveProvider(providerIdOf(a.id))
    if (!prov) {
      broadcast(session.id, {
        type: 'error',
        message: '无可用的 Provider。请在设置中配置至少一个模型连接。',
      })
      session.status = 'error'
      session.error = '无可用的 Provider'
      session.finishedReason = 'error'
      saveSession(session)
      rt.running = false
      return
    }
    const conn: ConnectionConfig = {
      baseUrl: prov.baseUrl,
      apiKey: prov.apiKey,
      model: prov.model,
      protocol: prov.protocol,
    }
    const rates: CostRates = {
      currency: prov.pricing.currency,
      inputPerMTok: prov.pricing.inputPerMTok,
      outputPerMTok: prov.pricing.outputPerMTok,
      cacheHitEnabled: prov.pricing.cacheHitEnabled,
      cacheHitPerMTok: prov.pricing.cacheHitPerMTok,
      cacheWriteEnabled: prov.pricing.cacheWriteEnabled,
      cacheWritePerMTok: prov.pricing.cacheWritePerMTok,
    }
    runtimes2.push({
      id: a.id,
      ref: a,
      mem: memMap.get(a.id)!,
      conn,
      rates,
      provName: prov.name,
    })
  }

  // 选举展示货币（按各 Provider 货币数量多数决定，平票用 CNY）+ 拉取汇率
  const displayCurrency = pickDisplayCurrency(runtimes2.map((r) => r.rates.currency))
  const exchangeRates = await getRatesWithFallback()

  try {
    while (true) {
      // === 1. 顶部检查停止条件 ===
      if (rt.stopRequested || session.status !== 'running') {
        if (rt.stopRequested && !session.finishedReason) {
          session.status = 'stopped'
          session.finishedReason = 'stopped'
          session.stoppedAt = Date.now()
        }
        break
      }

      const round = currentRound(session)

      // 用户轮数上限
      if (session.config.maxRounds > 0 && round >= session.config.maxRounds) {
        session.finishedReason = 'max_rounds'
        break
      }
      // 全局硬熔断：轮数
      if (round >= config.absoluteMaxRounds) {
        session.finishedReason = 'absolute_limit'
        break
      }
      // 用户时长上限
      if (
        session.config.durationSec > 0 &&
        Date.now() - (session.startedAt ?? 0) >= session.config.durationSec * 1000
      ) {
        session.finishedReason = 'duration'
        break
      }
      // 全局硬熔断：时长
      if (Date.now() - (session.startedAt ?? 0) >= config.absoluteMaxDurationSec * 1000) {
        session.finishedReason = 'absolute_limit'
        break
      }

      // === 2. 决定当前发言者 ===
      const agentId: AgentId = session.currentAgentId
      const cur = runtimes2.find((r) => r.id === agentId) ?? runtimes2[0]!
      const others = runtimes2.filter((r) => r.id !== agentId)

      // === 3. 触发摘要？ ===
      const roundsSinceSummary = round - cur.mem.lastSummarizedRound
      const shouldSummarize =
        cur.mem.messages.length > session.config.keepRecent &&
        roundsSinceSummary >= session.config.summaryEveryN
      if (shouldSummarize) {
        broadcast(session.id, {
          type: 'summary',
          agentId,
          phase: 'start',
        })
        try {
          const { content: summary, usage: summaryUsage } = await summarizeConversation({
            agentName: cur.ref.name,
            others: cur.mem.others,
            messages: cur.mem.messages,
            oldSummary: cur.mem.summary,
            words: 200,
            conn: cur.conn,
          })
          if (summary) {
            // 摘要调用成本也计入会话总成本（按该 Agent 的 Provider 单价 + 展示货币换算）
            addStats(session, summaryUsage, cur.rates, displayCurrency, exchangeRates)
            cur.mem.applySummary(summary, round)
            cur.mem.trimToRecent(session.config.keepRecent)
            broadcast(session.id, {
              type: 'summary',
              agentId,
              phase: 'done',
              summary,
            })
          }
        } catch (e) {
          // 摘要失败不致命，继续对话
          broadcast(session.id, {
            type: 'summary',
            agentId,
            phase: 'error',
            message: errorMessage(e),
          })
        }
      }

      // === 4. 组装 messages（首条加开场提示）===
      // 先同步 session 级 relationships → 当前 agent 的 memory（PATCH 运行时修改生效）
      cur.mem.relationships = session.relationships || {}

      if (session.messageCount === 0 && agentId === 'A' && cur.mem.messages.length === 0) {
        cur.mem.pushOther(
          buildOpeningPrompt({
            name: cur.ref.name,
            otherNames: cur.mem.others.map((o) => o.name),
            topic: session.topic,
          })
        )
      }

      const apiMessages = cur.mem.buildApiMessages(
        session.config.keepRecent,
        session.config.scenario,
        session.config.globalPrompt,
      )

      // === 5. 调模型流式 ===
      rt.abortCtrl = new AbortController()
      let content = ''
      try {
        const result = await getAdapter(cur.conn.protocol).chatCompletion({
          messages: apiMessages,
          conn: cur.conn,
          temperature: session.config.temperature,
          maxTokens: 1024,
          signal: rt.abortCtrl.signal,
          onContent: (chunk) => {
            content += chunk
            broadcast(session.id, { type: 'chunk', agentId, content: chunk })
          },
          onReasoning: () => {
            // 思维链不推前端，仅后端日志（按需开启）
          },
        })

        // === 6. 写入记忆 ===
        content = content.trim()
        if (!content) {
          // 模型返回空，避免死循环
          content = '（无内容）'
        }

        const usage: NormalizedUsage = result.usage
        addStats(session, usage, cur.rates, displayCurrency, exchangeRates)
        // 累计发言字符数（用于右上角统计展示）
        session.stats.totalChars += content.length

        // === 诊断日志：缓存命中情况 ===
        {
          const prompt = usage.prompt_tokens ?? 0
          const hit = usage.prompt_cache_hit_tokens ?? 0
          const miss = usage.prompt_cache_miss_tokens ?? 0
          const completion = usage.completion_tokens ?? 0
          const hitRate = prompt > 0 ? ((hit / prompt) * 100).toFixed(1) : '0.0'
          console.log(
            `[cache] 轮${round} ${agentId} [${cur.provName}] | prompt=${prompt} (命中=${hit}, 未命中=${miss}, 命中率=${hitRate}%) | 输出=${completion}`
          )
        }

        const ts = Date.now()
        const msg: PersistedMessage = {
          agentId,
          role: 'assistant',
          content,
          ts,
          tokens: {
            prompt: usage.prompt_tokens || 0,
            completion: usage.completion_tokens || 0,
          },
          truncated: false,
        }
        session.messages.push(msg)

        // 自己视角：assistant
        cur.mem.pushSelf(content)
        // 所有其他人视角：user（加发言者名前缀，content-only）
        for (const o of others) {
          o.mem.pushOther(wrapOtherMessage(cur.ref.name, content))
        }

        session.messageCount += 1
        session.currentAgentId = nextAgentId(session)
        session.updatedAt = ts
        saveSession(session)

        broadcast(session.id, { type: 'message_done', agentId, message: msg })
        broadcast(session.id, {
          type: 'stats',
          totalPromptTokens: session.stats.totalPromptTokens,
          totalCompletionTokens: session.stats.totalCompletionTokens,
          totalTokens: session.stats.totalTokens,
          totalCacheHitTokens: session.stats.totalCacheHitTokens,
          totalCacheMissTokens: session.stats.totalCacheMissTokens,
          totalCacheWriteTokens: session.stats.totalCacheWriteTokens,
          estCost: session.stats.estCost,
          costCurrency: session.stats.costCurrency,
          totalChars: session.stats.totalChars,
        })
        broadcast(session.id, {
          type: 'turn_end',
          round: currentRound(session),
          messageCount: session.messageCount,
        })
      } catch (e) {
        // === 流式中断 / API 错误 ===
        const aborted = isAbortError(e, rt.abortCtrl)
        // stopSession 可能在 await 期间把 status 改为 'stopped'；
        // TS 无法追踪跨 await 的外部修改，需以宽类型重新读取实际值
        const statusNow = session.status as SessionStatus
        // 用户主动停止：保留已收 chunk，静默退出（不报错）
        if (statusNow === 'stopped') {
          if (content.trim()) {
            const msg: PersistedMessage = {
              agentId,
              role: 'assistant',
              content: content.trim(),
              ts: Date.now(),
              tokens: { prompt: 0, completion: 0 },
              truncated: true,
            }
            session.messages.push(msg)
            cur.mem.pushSelf(content.trim())
            for (const o of others) {
              o.mem.pushOther(wrapOtherMessage(cur.ref.name, content.trim()))
            }
            session.messageCount += 1
            saveSession(session)
            broadcast(session.id, { type: 'message_done', agentId, message: msg })
          }
          break
        }
        // 其它错误（含超时） → error 状态
        session.status = 'error'
        session.error = aborted ? '请求超时或被中断' : errorMessage(e)
        session.finishedReason = 'error'
        saveSession(session)
        broadcast(session.id, { type: 'error', message: session.error })
        break
      } finally {
        rt.abortCtrl = null
      }
    } // end while

    // === 循环退出 ===
    if (session.status === 'running') {
      session.status = 'finished'
    }
    if (!session.stoppedAt) session.stoppedAt = Date.now()
    // 写回 memory 实例
    for (const a of session.agents) {
      const m = memMap.get(a.id)
      if (m) session.memory[a.id] = m.toJSON()
    }
    saveSession(session)
    broadcast(session.id, {
      type: 'finished',
      reason: session.finishedReason || (session.status === 'error' ? 'error' : 'stopped'),
    })
  } finally {
    rt.running = false
    rt.activeSession = null
    rt.stopRequested = false
  }
}
