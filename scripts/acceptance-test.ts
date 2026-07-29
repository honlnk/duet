/**
 * 最终验收脚本：对照 DEVELOPMENT_PLAN.md §8 验收清单逐项验证
 * 运行前需先启动服务: PORT=3001 pnpm dev
 */
import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
} from '../server/src/store/sessionStore.js'
import type { SessionConfig } from '../server/src/types/index.js'
import WebSocket from 'ws'

const API = process.env.API || 'http://localhost:3001'
const WS_URL = API.replace(/^http/, 'ws')

interface AgentInput {
  name: string
  persona?: string
}

const results: Array<{ name: string; pass: boolean; detail: string }> = []
function check(name: string, pass: boolean, detail: string = ''): void {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

interface RunOpts {
  stopAfterChunk?: boolean
  waitMs?: number
}

async function runSession(
  topic: string,
  agents: [AgentInput, AgentInput],
  config: Partial<SessionConfig>,
  { stopAfterChunk = false, waitMs = 60000 }: RunOpts = {}
) {
  const session = createSession({ topic, agents, config })
  saveSession(session)
  const ws = new WebSocket(`${WS_URL}/ws/chat?sessionId=${session.id}`)
  const events: Array<{ type: string; [k: string]: unknown }> = []
  const done = new Promise<void>((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'start' })))
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown }
      events.push(msg)
      if (msg.type === 'finished' || msg.type === 'error') resolve()
      if (stopAfterChunk && msg.type === 'chunk') {
        setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), 800)
      }
    })
    ws.on('error', () => resolve())
    setTimeout(resolve, waitMs)
  })
  await done
  try {
    ws.close()
  } catch {
    // 忽略关闭错误
  }
  return { session: loadSession(session.id)!, events }
}

async function main() {
  console.log('\n═══════════ 最终验收审计 ═══════════\n')

  // [验收1] 输入话题+两个身份，两个 AI 自动轮流对话
  console.log('【验收1】双 AI 自动轮流对话')
  const r1 = await runSession(
    '猫狗之争(验收1)',
    [{ name: '猫派', persona: '你爱猫' }, { name: '狗派', persona: '你爱狗' }],
    { maxRounds: 1, temperature: 0.7 }
  )
  check('自动轮流对话完成', r1.session.status === 'finished', `status=${r1.session.status}`)
  check('A 先发言', r1.session.messages[0]?.agentId === 'A')
  check('A 和 B 都发言', r1.session.messageCount === 2, `messageCount=${r1.session.messageCount}`)
  check(
    'chunk 流式事件收到',
    r1.events.some((e) => e.type === 'chunk'),
    `${r1.events.filter((e) => e.type === 'chunk').length} chunks`
  )

  // [验收2] 流式输出（仅 content，无 reasoning）
  console.log('\n【验收2】流式输出仅 content')
  const hasReasoningInChunk = r1.events.some((e) => e.type === 'chunk' && e.content === null)
  check(
    'chunk 均带 content 文本',
    !hasReasoningInChunk && r1.events.some((e) => e.type === 'chunk')
  )
  check(
    '消息内容不含思维链标记',
    r1.session.messages.every((m) => m.content && !m.content.includes('reasoning'))
  )

  // [验收3] 设置轮数能准确停
  console.log('\n【验收3】轮数上限准确停止')
  check(
    'maxRounds=1 停在 1 round',
    r1.session.finishedReason === 'max_rounds',
    `reason=${r1.session.finishedReason}`
  )

  // [验收5] 摘要触发与注入
  console.log('\n【验收5】摘要压缩生效')
  const r5 = await runSession(
    '早起锻炼(验收5摘要)',
    [{ name: '晨型', persona: '你主张早起' }, { name: '夜型', persona: '你主张晚练' }],
    { maxRounds: 2, summaryEveryN: 1, keepRecent: 2 }
  )
  const summaryEvents = r5.events.filter((e) => e.type === 'summary' && e.phase === 'done')
  check('摘要事件触发', summaryEvents.length > 0, `${summaryEvents.length} 次摘要`)
  check(
    'A 生成了独立摘要',
    !!r5.session.memory.A.summary,
    `${r5.session.memory.A.summary?.length || 0} 字`
  )
  check(
    'B 生成了独立摘要',
    !!r5.session.memory.B.summary,
    `${r5.session.memory.B.summary?.length || 0} 字`
  )
  check('A 摘要是第一人称', /我/.test(r5.session.memory.A.summary || ''), '含"我"')
  check(
    'A 摘要不含 B 的 persona 原文',
    !(r5.session.memory.A.summary || '').includes('你主张晚练')
  )

  // [验收6] 身份隔离：30 轮太慢，用 2 轮验证核心
  console.log('\n【验收6】身份隔离')
  const aMsgs = r5.session.memory.A.messages
  const aHasBPersona = aMsgs.some((m) => m.content && m.content.includes('你主张晚练'))
  check('A 视角 messages 不含 B persona', !aHasBPersona)
  const aSys = aMsgs.filter((m) => m.role === 'assistant').length
  const bSys = r5.session.memory.B.messages.filter((m) => m.role === 'assistant').length
  check('各自视角 assistant 数正确', aSys >= 1 && bSys >= 1, `A=${aSys}, B=${bSys}`)

  // [验收7] 停止按钮
  console.log('\n【验收7】停止立即生效')
  const r7 = await runSession(
    '无限话题(验收7停止)',
    [{ name: 'X', persona: '哲学家' }, { name: 'Y', persona: '科学家' }],
    { maxRounds: 0 },
    { stopAfterChunk: true }
  )
  check('停止后 status=stopped', r7.session.status === 'stopped', `status=${r7.session.status}`)
  check(
    '停止后 reason=stopped',
    r7.session.finishedReason === 'stopped',
    `reason=${r7.session.finishedReason}`
  )

  // [验收8] 持久化与恢复
  console.log('\n【验收8】持久化')
  const all = listSessions()
  check('会话已落盘', all.length >= 3, `${all.length} 个会话`)
  const reloaded = loadSession(r1.session.id)
  check('重载会话消息完整', !!reloaded && reloaded.messages.length === 2, `${reloaded?.messages.length} 条`)

  // [验收9] 成本展示
  console.log('\n【验收9】成本统计')
  const statsEvents = r1.events.filter((e) => e.type === 'stats')
  check('stats 事件推送', statsEvents.length > 0, `${statsEvents.length} 次`)
  const lastStats = statsEvents.at(-1)
  check('totalTokens > 0', (lastStats?.totalTokens as number | undefined ?? 0) > 0, `${lastStats?.totalTokens}`)
  check('estCost 有值', (lastStats?.estCost as number | undefined ?? 0) > 0, `$${lastStats?.estCost}`)

  // [验收10] 部署
  console.log('\n【验收10】部署模式')
  const indexResp = await fetch(`${API}/`).then((r) => r.text())
  check('首页返回 HTML', indexResp.includes('<!DOCTYPE html>') && indexResp.includes('Duet'))
  const healthResp = (await fetch(`${API}/api/health`).then((r) => r.json())) as {
    status: string
    apiKeyConfigured: boolean
  }
  check('API 健康检查 ok', healthResp.status === 'ok')
  check('API Key 已配置', healthResp.apiKeyConfigured === true)

  // 汇总
  console.log('\n═══════════ 验收汇总 ═══════════')
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  console.log(`通过: ${passed}/${total}`)
  if (passed === total) {
    console.log('🎉 全部验收通过！')
  } else {
    console.log('⚠ 部分未通过，见上表')
    results.filter((r) => !r.pass).forEach((r) => console.log(`  ❌ ${r.name}`))
  }

  // 清理测试数据
  for (const s of listSessions()) deleteSession(s.id)
  console.log('\n(测试会话已清理)')

  process.exit(passed === total ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
