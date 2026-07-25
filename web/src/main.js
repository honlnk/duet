import {
  els,
  getFormPayload,
  setButtons,
  setStatus,
  updateStats,
  updateRound,
  startDurationTracker,
  stopDurationTracker,
  appendMessage,
  startStreaming,
  appendChunk,
  finishStreaming,
  addEvent,
  clearAll,
} from './ui.js'
import { createSession, getSession, getLimits, connectWS } from './api.js'

let ws = null
let currentSession = null

function nameOf(session, agentId) {
  return session.agents.find((a) => a.id === agentId)?.name || agentId
}

/** 渲染已有会话（重连 / 刷新恢复） */
function renderSession(session) {
  currentSession = session
  setStatus(session.status)
  updateRound(
    Math.floor((session.messageCount || 0) / 2),
    session.config?.maxRounds || 0
  )
  updateStats(session.stats)
  // 历史消息
  clearAll()
  for (const m of session.messages || []) {
    appendMessage({
      agentId: m.agentId,
      name: nameOf(session, m.agentId),
      content: m.content,
      truncated: m.truncated,
    })
  }
  if (session.startedAt) {
    startDurationTracker(session.startedAt, session.config?.durationSec || 0)
  }
  if (session.status === 'running') {
    setButtons({ start: false, stop: true })
  } else {
    setButtons({ start: true, stop: false })
  }
}

async function handleStart() {
  const payload = getFormPayload()
  if (!payload.topic) {
    addEvent({ type: 'error', text: '请填写话题' })
    return
  }
  try {
    setButtons({ start: false, stop: false })
    addEvent({ type: '', text: '创建会话…' })
    const session = await createSession(payload)
    currentSession = session
    renderSession(session)
    addEvent({ type: '', text: `会话已创建：${session.id}` })

    // 连接 WS
    if (ws) ws.close()
    ws = connectWS(session.id, {
      onMessage: (msg) => handleWsMessage(msg, session),
    })
    // 等 WS open 后发 start
    setTimeout(() => {
      if (ws) {
        ws.send({ type: 'start' })
        addEvent({ type: '', text: '已发送开始指令' })
      }
    }, 300)
  } catch (e) {
    addEvent({ type: 'error', text: e.message })
    setButtons({ start: true, stop: false })
  }
}

function handleWsMessage(msg, session) {
  switch (msg.type) {
    case 'sync':
      renderSession(msg.session)
      break
    case 'started':
      setStatus('running')
      setButtons({ start: false, stop: true })
      startDurationTracker(session.startedAt || Date.now(), session.config?.durationSec || 0)
      break
    case 'chunk':
      if (currentStreaming !== msg.agentId) {
        currentStreaming = msg.agentId
        startStreaming(msg.agentId, nameOf(session, msg.agentId))
      }
      appendChunk(msg.content)
      break
    case 'message_done':
      currentStreaming = null
      appendMessage({
        agentId: msg.agentId,
        name: nameOf(session, msg.agentId),
        content: msg.message.content,
        truncated: msg.message.truncated,
      })
      break
    case 'summary':
      if (msg.phase === 'start') {
        addEvent({ type: 'summary', text: `${nameOf(session, msg.agentId)} 正在整理记忆…` })
      } else if (msg.phase === 'done') {
        addEvent({ type: 'summary', text: `${nameOf(session, msg.agentId)} 记忆已更新（${msg.summary.length} 字）` })
      } else if (msg.phase === 'error') {
        addEvent({ type: 'error', text: `摘要失败: ${msg.message}` })
      }
      break
    case 'stats':
      updateStats(msg)
      break
    case 'turn_end':
      updateRound(msg.round, session.config?.maxRounds || 0)
      break
    case 'finished':
      currentStreaming = null
      finishStreaming()
      // 重载会话状态
      getSession(session.id).then((s) => { if (s) renderSession(s) })
      stopDurationTracker()
      setButtons({ start: true, stop: false })
      addEvent({ type: msg.reason === 'error' ? 'error' : '', text: `对话结束（${msg.reason}）` })
      break
    case 'error':
      addEvent({ type: 'error', text: msg.message })
      break
  }
}

// 模块级变量：当前正在流式输出的 agentId
let currentStreaming = null

function handleStop() {
  if (ws) ws.send({ type: 'stop' })
  addEvent({ type: '', text: '已发送停止指令' })
  setButtons({ start: false, stop: false })
}

function handleReset() {
  if (ws) { ws.close(); ws = null }
  currentSession = null
  clearAll()
  stopDurationTracker()
  setStatus('idle')
  updateRound(0, 0)
  els.costInfo.textContent = '0 token · $0.00'
  els.timeInfo.textContent = '时长 ∞'
  setButtons({ start: true, stop: false })
}

function bind() {
  els.btnStart.addEventListener('click', handleStart)
  els.btnStop.addEventListener('click', handleStop)
  els.btnReset.addEventListener('click', handleReset)
  els.toggleSidebar.addEventListener('click', (e) => {
    e.preventDefault()
    const layout = document.querySelector('.layout')
    layout.classList.toggle('sidebar-hidden')
    els.toggleSidebar.textContent = layout.classList.contains('sidebar-hidden')
      ? '展开 ◂'
      : '收起 ▸'
  })

  // 加载全局限制展示
  getLimits().then((l) => {
    addEvent({
      type: '',
      text: `全局熔断：≤ ${l.absoluteMaxRounds} 轮 / ${l.absoluteMaxDurationSec}s`,
    })
  }).catch(() => {})
}

bind()
