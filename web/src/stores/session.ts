/**
 * 会话 Store —— 多智能体自主对话的核心状态机
 *
 * 管理：当前会话、状态、消息流、流式累积、统计、事件日志、视角。
 *
 * 关键契约（务必遵守）：
 * 1. chunk 事件无消息 id，需用 streamingAgentId 追踪当前发言者。
 * 2. message_done 时若存在同 agentId 的流式气泡，替换其内容而非新增（去重）。
 * 3. stats 事件字段在顶层展开（msg.totalTokens），非嵌套。
 * 4. finished 后需重拉 GET /api/sessions/:id 取权威终态。
 *
 * 视角（viewSide）：用户在右侧面板选择的「右侧显示」智能体 id。
 *   - 选中的智能体消息靠右对齐（强调条在右），其余靠左（强调条在左）。
 *   - 默认为会话的第二个智能体（B）。
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { createSession, getSession, updateRelationships } from '@/services/api'
import type {
  Agent,
  AgentId,
  ChatMessage,
  ServerEvent,
  Session,
  SessionStatus,
  SessionStats,
} from '@/types/api'
import type { CreateSessionPayload } from '@/types/api'

/** 事件日志条目（前端展示用） */
export interface EventLogItem {
  id: number
  type: 'summary' | 'error' | 'info'
  text: string
  ts: number
}

/**
 * 视图层消息：合并已落盘消息与进行中的流式气泡。
 * streaming=true 表示当前正在流式生成（带光标）。
 */
export interface ViewMessage {
  uid: string
  agentId: AgentId
  content: string
  truncated: boolean
  streaming: boolean
}

let uidSeq = 0
function nextUid(): string {
  return `m${++uidSeq}`
}

export const useSessionStore = defineStore('session', () => {
  /** 当前会话（shallowRef：整体替换，避免深层响应式开销） */
  const session = shallowRef<Session | null>(null)

  /** 状态徽章（独立维护，便于即时刷新） */
  const status = ref<SessionStatus>('idle')

  /** 视图消息列表（已落盘 + 流式中） */
  const messages = ref<ViewMessage[]>([])

  /** 当前轮次（1 round = A+B 各说一句） */
  const round = ref(0)
  /** 轮次上限（0/undefined = 无限） */
  const maxRounds = ref(0)

  /** 累计统计 */
  const stats = ref<SessionStats>({
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCacheHitTokens: 0,
    totalCacheMissTokens: 0,
    totalCacheWriteTokens: 0,
    estCost: 0,
    costCurrency: '',
    totalChars: 0,
  })

  /** 会话开始时间戳（用于计时器） */
  const startedAt = ref<number | null>(null)
  /** 会话结束时间戳（用于冻结计时器展示） */
  const stoppedAt = ref<number | null>(null)
  /** 持续时间上限秒数（0 = 无限） */
  const durationSec = ref(0)

  /** 事件日志 */
  const eventLog = ref<EventLogItem[]>([])

  /** 错误信息（最近一次） */
  const errorMessage = ref<string | null>(null)

  /**
   * 待启动标记：新建会话后置为 true，由 SessionView 加载该会话后
   * 据此建立 WS 并发送 start（避免 NewChatModal 与 SessionView 双重管理 WS）。
   */
  const pendingStart = ref(false)

  /**
   * 会话详情右侧栏开关（UI 状态）。
   * 放进 store 是为了跨越 router-view 边界：主区 header 的 toggle 按钮
   * 与 SessionView 内的 SessionInspector 都能读写同一份状态。
   */
  const inspectorOpen = ref(true)

  function toggleInspector() {
    inspectorOpen.value = !inspectorOpen.value
  }

  /**
   * 左侧会话栏开关（UI 状态）。
   * - 桌面：sidebarCollapsed 控制内联收起/展开；
   * - 移动：drawerOpen 控制覆盖抽屉滑入/滑出。
   * 与 inspectorOpen 同理，放进 store 让各 View 的 header 按钮跨边界共享。
   */
  const sidebarCollapsed = ref(false)
  const drawerOpen = ref(false)

  function toggleSidebar(isMobile: boolean) {
    if (isMobile) drawerOpen.value = !drawerOpen.value
    else sidebarCollapsed.value = !sidebarCollapsed.value
  }

  /**
   * 智能体视角：选中的智能体 id，其消息靠右显示，其余靠左。
   * 默认为会话第二个智能体（B）；加载会话时按 agents 重置。
   */
  const viewSide = ref<AgentId>('B')

  /** 切换视角（右侧面板的智能体选择器调用） */
  function setViewSide(id: AgentId) {
    viewSide.value = id
  }

  // --- 流式状态（非响应式，避免每个 chunk 触发大量依赖） ---
  let streamingAgentId: AgentId | null = null

  /* --------------------------- 计算属性 --------------------------- */

  /** 是否正在对话中 */
  const isRunning = computed(() => status.value === 'running')
  /** 是否可操作（非空闲且非运行中也允许停止/重置） */
  const canStop = computed(
    () => status.value === 'running' || status.value === 'idle',
  )

  /* --------------------------- 内部工具 --------------------------- */

  function log(type: EventLogItem['type'], text: string) {
    eventLog.value.push({
      id: eventLog.value.length + 1,
      type,
      text,
      ts: Date.now(),
    })
  }

  /** 查找指定 agentId 的流式气泡（去重用） */
  function findStreaming(agentId: AgentId): ViewMessage | undefined {
    return messages.value.find((m) => m.agentId === agentId && m.streaming)
  }

  /** 智能体显示名 */
  function agentName(agentId: AgentId): string {
    const a = session.value?.agents.find((x) => x.id === agentId)
    return a?.name ?? agentId
  }

  /** 查找智能体对象 */
  function findAgent(agentId: AgentId): Agent | undefined {
    return session.value?.agents.find((x) => x.id === agentId)
  }

  /** 判断某智能体消息是否靠右显示（即是否为当前视角） */
  function isRightSide(agentId: AgentId): boolean {
    return agentId === viewSide.value
  }

  /* --------------------------- 重置/渲染 --------------------------- */

  /** 清空运行态（保留会话配置） */
  function resetRuntime() {
    messages.value = []
    eventLog.value = []
    streamingAgentId = null
    round.value = 0
    errorMessage.value = null
    stats.value = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCacheHitTokens: 0,
      totalCacheMissTokens: 0,
      totalCacheWriteTokens: 0,
      estCost: 0,
      costCurrency: '',
      totalChars: 0,
    }
  }

  /**
   * 从完整 Session 对象渲染（sync / 创建 / finished 重拉后调用）。
   * 重放所有历史消息为已落盘气泡。
   */
  function renderSession(s: Session) {
    session.value = s
    status.value = s.status
    maxRounds.value = s.config.maxRounds
    durationSec.value = s.config.durationSec
    startedAt.value = s.startedAt
    stoppedAt.value = s.stoppedAt
    stats.value = { ...s.stats }
    streamingAgentId = null
    // 视角默认为第二个智能体（B）；若会话已切换视角且仍有效则保留
    const validIds = s.agents.map((a) => a.id)
    if (!validIds.includes(viewSide.value)) {
      viewSide.value = s.agents[1]?.id ?? s.agents[0]!.id
    }
    // 重放历史消息
    messages.value = s.messages.map<ViewMessage>((m) => ({
      uid: nextUid(),
      agentId: m.agentId,
      content: m.content,
      truncated: m.truncated,
      streaming: false,
    }))
    // round = 所有智能体各说一句算 1 轮
    const n = s.agents.length || 2
    round.value = Math.floor(s.messageCount / n)
    if (s.error) errorMessage.value = s.error
  }

  /* --------------------------- WS reducer --------------------------- */

  /**
   * 处理服务器事件（核心 reducer）。
   * @returns 'finished' 表示对话循环已结束（调用方据此重拉会话）
   */
  function handleEvent(msg: ServerEvent): 'finished' | 'none' {
    switch (msg.type) {
      case 'sync':
        renderSession(msg.session)
        return 'none'

      case 'started':
        status.value = 'running'
        if (!startedAt.value) startedAt.value = Date.now()
        return 'none'

      case 'chunk': {
        // 切换发言者：开始新的流式气泡
        if (streamingAgentId !== msg.agentId) {
          streamingAgentId = msg.agentId
          // 复用同 agentId 的流式气泡（去重），否则新建
          let bubble = findStreaming(msg.agentId)
          if (!bubble) {
            bubble = {
              uid: nextUid(),
              agentId: msg.agentId,
              content: '',
              truncated: false,
              streaming: true,
            }
            messages.value.push(bubble)
          }
          bubble.content += msg.content
        } else {
          // 累积到现有流式气泡
          const bubble = findStreaming(msg.agentId)
          if (bubble) bubble.content += msg.content
        }
        return 'none'
      }

      case 'message_done': {
        // 落定：用权威 message 替换流式气泡（去重关键逻辑）
        const idx = messages.value.findIndex(
          (m) => m.agentId === msg.agentId && m.streaming,
        )
        const final: ViewMessage = {
          uid: idx >= 0 ? messages.value[idx]!.uid : nextUid(),
          agentId: msg.agentId,
          content: msg.message.content,
          truncated: msg.message.truncated,
          streaming: false,
        }
        if (idx >= 0) {
          messages.value.splice(idx, 1, final)
        } else {
          messages.value.push(final)
        }
        return 'none'
      }

      case 'stats':
        // 注意：字段在顶层展开，非嵌套
        stats.value = {
          totalPromptTokens: msg.totalPromptTokens,
          totalCompletionTokens: msg.totalCompletionTokens,
          totalTokens: msg.totalTokens,
          totalCacheHitTokens: msg.totalCacheHitTokens,
          totalCacheMissTokens: msg.totalCacheMissTokens,
          totalCacheWriteTokens: msg.totalCacheWriteTokens,
          estCost: msg.estCost,
          costCurrency: msg.costCurrency,
          totalChars: msg.totalChars,
        }
        return 'none'

      case 'turn_end':
        round.value = msg.round
        return 'none'

      case 'summary': {
        const name = agentName(msg.agentId)
        if (msg.phase === 'start') {
          log('summary', `${name} 正在整理记忆…`)
        } else if (msg.phase === 'done') {
          log('summary', `${name} 记忆已更新`)
        } else {
          log('error', `${name} 摘要失败：${msg.message ?? '未知错误'}`)
        }
        return 'none'
      }

      case 'error':
        errorMessage.value = msg.message
        log('error', msg.message)
        return 'none'

      case 'finished':
        // 标记但延迟设最终 status（等重拉权威数据）
        return 'finished'

      case 'pong':
        return 'none'

      default:
        // 穷尽性检查（TS 保证）
        return 'none'
    }
  }

  /** finished 后用权威 Session 同步终态 */
  async function syncFinalStatus(id: string) {
    const fresh = await getSession(id)
    if (fresh) {
      status.value = fresh.status
      stoppedAt.value = fresh.stoppedAt
      if (fresh.error) errorMessage.value = fresh.error
      // 若有消息差异（罕见），用权威数据对齐
      if (fresh.messages.length > messages.value.length) {
        messages.value = fresh.messages.map<ViewMessage>((m) => ({
          uid: nextUid(),
          agentId: m.agentId,
          content: m.content,
          truncated: m.truncated,
          streaming: false,
        }))
      }
      const n = fresh.agents.length || 2
      round.value = Math.floor(fresh.messageCount / n)
      stats.value = { ...fresh.stats }
    } else {
      status.value = 'stopped'
    }
  }

  /* --------------------------- 对外动作 --------------------------- */

  /** 创建会话（REST），渲染并返回 id（供 WS 连接用） */
  async function create(payload: CreateSessionPayload): Promise<string> {
    const s = await createSession(payload)
    renderSession(s)
    return s.id
  }

  /**
   * 按 id 加载已有会话（从路由 param 恢复 / 切换历史会话）。
   * 会重置运行态并重放该会话的消息。返回是否加载成功。
   */
  async function load(id: string): Promise<boolean> {
    const s = await getSession(id)
    if (!s) return false
    resetRuntime()
    renderSession(s)
    return true
  }

  /**
   * 更新当前会话的关系数据（关系图 + 节点位置）。
   * 调用后端 PATCH 接口，并同步本地 session 对象。
   */
  async function saveRelationships(
    id: string,
    body: {
      relationships?: Record<string, string>
      nodePositions?: Record<string, { x: number; y: number }>
    },
  ): Promise<boolean> {
    try {
      const s = await updateRelationships(id, body)
      // 同步本地 session 引用（shallowRef 需整体替换触发响应）
      if (session.value) {
        session.value = { ...s }
      } else {
        session.value = s
      }
      return true
    } catch {
      return false
    }
  }

  /** 重置：清空当前会话与运行态 */
  function clearSession() {
    session.value = null
    status.value = 'idle'
    resetRuntime()
    startedAt.value = null
    stoppedAt.value = null
    maxRounds.value = 0
    durationSec.value = 0
  }

  return {
    // state
    session,
    status,
    messages,
    round,
    maxRounds,
    stats,
    startedAt,
    stoppedAt,
    durationSec,
    eventLog,
    errorMessage,
    pendingStart,
    inspectorOpen,
    sidebarCollapsed,
    drawerOpen,
    viewSide,
    // computed
    isRunning,
    canStop,
    // actions
    handleEvent,
    syncFinalStatus,
    create,
    load,
    saveRelationships,
    clearSession,
    resetRuntime,
    log,
    agentName,
    findAgent,
    isRightSide,
    setViewSide,
    toggleInspector,
    toggleSidebar,
  }
})
