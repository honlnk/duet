// 端到端测试：创建会话 -> WS 连接 -> start -> 收集事件 -> 校验
// 用法: node scripts/test-e2e.js
import { createSession } from '../server/src/store/sessionStore.js'
import { saveSession, loadSession } from '../server/src/store/sessionStore.js'
import WebSocket from 'ws'

const API = process.env.API || 'http://localhost:3001'
const WS_URL = API.replace(/^http/, 'ws')

async function main() {
  // 创建会话
  const session = createSession({
    topic: '猫和狗哪个更适合做家庭宠物（简短辩论，2轮）',
    agents: [
      { name: '猫派', persona: '你认为猫独立干净，是更好的家庭宠物。' },
      { name: '狗派', persona: '你认为狗忠诚亲人，是更好的家庭宠物。' },
    ],
    config: { maxRounds: 2, temperature: 0.7, summaryEveryN: 10, keepRecent: 8 },
  })
  saveSession(session)
  console.log(`[test] 会话已创建: ${session.id}`)

  // 连 WS
  const ws = new WebSocket(`${WS_URL}/ws/chat?sessionId=${session.id}`)
  const events = []
  let finished = false

  const done = new Promise((resolve) => {
    ws.on('open', () => {
      console.log('[test] WS 已连接，发送 start')
      ws.send(JSON.stringify({ type: 'start' }))
    })
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      events.push(msg)
      if (msg.type === 'chunk') {
        process.stdout.write(msg.content)
      } else if (msg.type === 'message_done') {
        console.log(`\n[test] 消息完成 (${msg.agentId}): ${msg.message.content.slice(0, 50)}...`)
      } else if (msg.type === 'stats') {
        console.log(`[test] stats: ${msg.totalTokens} token, $${msg.estCost}`)
      } else if (msg.type === 'turn_end') {
        console.log(`[test] 轮次结束: round=${msg.round}, messageCount=${msg.messageCount}`)
      } else if (msg.type === 'summary') {
        console.log(`[test] 摘要 ${msg.agentId} ${msg.phase}`)
      } else if (msg.type === 'finished') {
        console.log(`[test] 对话结束: ${msg.reason}`)
        finished = true
        resolve()
      } else if (msg.type === 'error') {
        console.error(`[test] 错误: ${msg.message}`)
        resolve()
      } else {
        console.log(`[test] 事件: ${msg.type}`)
      }
    })
    ws.on('error', (e) => {
      console.error('[test] WS 错误', e.message)
      resolve()
    })
    ws.on('close', () => {
      if (!finished) {
        console.log('[test] WS 关闭')
        resolve()
      }
    })
  })

  // 超时保护 90s
  await Promise.race([
    done,
    new Promise((r) => setTimeout(() => { console.log('[test] 超时'); r() }, 90000)),
  ])
  ws.close()

  // 校验最终状态
  const final = loadSession(session.id)
  console.log('\n========== 校验 ==========')
  console.log('status:', final.status)
  console.log('finishedReason:', final.finishedReason)
  console.log('messageCount:', final.messageCount, '(预期 4)')
  console.log('A messages:', final.memory.A.messages.length)
  console.log('B messages:', final.memory.B.messages.length)
  console.log('A summary:', final.memory.A.summary ? '有' : '无')
  console.log('stats:', JSON.stringify(final.stats))

  // 关键校验：A 的 messages 里不应出现 B 的 persona
  const aPersona = final.agents[1].persona
  const aHasBPersona = final.memory.A.messages.some((m) => m.content && m.content.includes(aPersona.slice(0, 10)))
  console.log('A 视角是否串入 B persona:', aHasBPersona ? '❌ 是(身份混淆!)' : '✅ 否(隔离正确)')

  // role 翻转校验
  const aSelf = final.memory.A.messages.filter((m) => m.role === 'assistant').length
  const bSelf = final.memory.B.messages.filter((m) => m.role === 'assistant').length
  console.log(`A 视角 assistant 数: ${aSelf}, B 视角 assistant 数: ${bSelf}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
