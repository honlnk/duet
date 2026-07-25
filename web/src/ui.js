const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

const els = {
  statusBadge: $('#status-badge'),
  roundInfo: $('#round-info'),
  timeInfo: $('#time-info'),
  costInfo: $('#cost-info'),
  messages: $('#messages'),
  eventLog: $('#event-log'),
  topic: $('#topic'),
  agentAName: $('#agent-a-name'),
  agentAPersona: $('#agent-a-persona'),
  agentBName: $('#agent-b-name'),
  agentBPersona: $('#agent-b-persona'),
  model: $('#model'),
  temperature: $('#temperature'),
  maxRounds: $('#max-rounds'),
  durationSec: $('#duration-sec'),
  summaryEveryN: $('#summary-every-n'),
  keepRecent: $('#keep-recent'),
  btnStart: $('#btn-start'),
  btnStop: $('#btn-stop'),
  btnReset: $('#btn-reset'),
  toggleSidebar: $('#toggle-sidebar'),
}

const state = {
  currentAgentStreaming: null, // 'A' | 'B'
  currentBubble: null,         // 当前正在流式输出的 DOM
  streamingText: '',
  startedAt: null,
  durationTimer: null,
}

export function getFormPayload() {
  const num = (v) => (v === '' || v == null ? 0 : Number(v))
  return {
    topic: els.topic.value.trim(),
    agents: [
      { name: els.agentAName.value.trim() || 'A', persona: els.agentAPersona.value.trim() },
      { name: els.agentBName.value.trim() || 'B', persona: els.agentBPersona.value.trim() },
    ],
    config: {
      model: els.model.value,
      temperature: Number(els.temperature.value) || 0.7,
      maxRounds: num(els.maxRounds.value),
      durationSec: num(els.durationSec.value),
      summaryEveryN: Number(els.summaryEveryN.value) || 10,
      keepRecent: Number(els.keepRecent.value) || 8,
    },
  }
}

export function setButtons({ start, stop }) {
  els.btnStart.disabled = !start
  els.btnStop.disabled = !stop
}

export function setStatus(status) {
  els.statusBadge.textContent = {
    idle: '待机',
    running: '对话中',
    stopped: '已停止',
    finished: '已完成',
    error: '错误',
  }[status] || status
  els.statusBadge.className = `badge ${status}`
}

export function updateStats(stats) {
  if (!stats) return
  const cost = Number(stats.estCost || 0).toFixed(4)
  els.costInfo.textContent = `${stats.totalTokens || 0} token · $${cost}`
}

export function updateRound(round, maxRounds) {
  const maxStr = maxRounds > 0 ? maxRounds : '∞'
  els.roundInfo.textContent = `轮次 ${round || 0} / ${maxStr}`
}

export function startDurationTracker(startedAt, durationSec) {
  state.startedAt = startedAt
  if (state.durationTimer) clearInterval(state.durationTimer)
  state.durationTimer = setInterval(() => {
    if (!state.startedAt) return
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000)
    let txt
    if (durationSec > 0) {
      const remain = Math.max(0, durationSec - elapsed)
      txt = `剩余 ${formatDuration(remain)}`
    } else {
      txt = `已运行 ${formatDuration(elapsed)}`
    }
    els.timeInfo.textContent = txt
  }, 1000)
}

export function stopDurationTracker() {
  if (state.durationTimer) {
    clearInterval(state.durationTimer)
    state.durationTimer = null
  }
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}s`
  return `${m}m${s.toString().padStart(2, '0')}s`
}

/** 渲染一条完整消息 */
export function appendMessage({ agentId, name, content, truncated }) {
  finishStreaming()
  clearEmptyHint()
  const div = document.createElement('div')
  div.className = `msg agent-${agentId}`
  div.innerHTML = `<span class="name">${escapeHtml(name)}${truncated ? '<span class="tag">[已截断]</span>' : ''}</span><span class="content"></span>`
  div.querySelector('.content').textContent = content
  els.messages.appendChild(div)
  scrollToBottom()
}

/** 开始一条流式消息 */
export function startStreaming(agentId, name) {
  finishStreaming()
  clearEmptyHint()
  state.currentAgentStreaming = agentId
  state.streamingText = ''
  const div = document.createElement('div')
  div.className = `msg agent-${agentId}`
  div.innerHTML = `<span class="name">${escapeHtml(name)}</span><span class="content cursor"></span>`
  els.messages.appendChild(div)
  state.currentBubble = div.querySelector('.content')
  scrollToBottom()
}

/** 流式追加 chunk */
export function appendChunk(text) {
  if (!state.currentBubble) return
  state.streamingText += text
  state.currentBubble.textContent = state.streamingText
  scrollToBottom()
}

/** 结束当前流式 */
export function finishStreaming() {
  if (state.currentBubble) {
    state.currentBubble.classList.remove('cursor')
  }
  state.currentBubble = null
  state.currentAgentStreaming = null
  state.streamingText = ''
}

export function addEvent({ type, text }) {
  const div = document.createElement('div')
  div.className = `event ${type || ''}`
  div.textContent = text
  els.eventLog.appendChild(div)
  els.eventLog.scrollTop = els.eventLog.scrollHeight
}

export function clearAll() {
  els.messages.innerHTML = '<div class="empty-hint">填写左侧设置后，点击「开始对话」</div>'
  els.eventLog.innerHTML = ''
}

export function clearEmptyHint() {
  const hint = els.messages.querySelector('.empty-hint')
  if (hint) hint.remove()
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

export { els }
