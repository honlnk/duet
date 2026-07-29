// 摘要功能测试：summaryEveryN=1，对话 2 轮后应触发摘要
import { createSession, saveSession, loadSession } from '../server/src/store/sessionStore.js'
import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://localhost:3001'

async function main() {
  // keepRecent=2 让消息数很快超过阈值，summaryEveryN=1 每轮触发
  const session = createSession({
    topic: '是否应该每天早起锻炼（简短辩论）',
    agents: [
      { name: '晨型人', persona: '你坚信早起锻炼让人精力充沛。' },
      { name: '夜型人', persona: '你认为晚上锻炼更符合人体节律。' },
    ],
    config: { maxRounds: 2, temperature: 0.7, summaryEveryN: 1, keepRecent: 2 },
  })
  saveSession(session)
  console.log(`[test] 会话: ${session.id}`)

  const ws = new WebSocket(`${WS_URL}/ws/chat?sessionId=${session.id}`)
  let summarySeen = false
  const done = new Promise<void>((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'start' })))
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown }
      if (msg.type === 'summary') {
        summarySeen = true
        const summary = msg.summary as string | undefined
        console.log(`[test] 摘要事件 ${msg.agentId} ${msg.phase}${summary ? ' (' + summary.length + '字)' : ''}`)
        if (summary) console.log(`  内容: ${summary.slice(0, 120)}...`)
      } else if (msg.type === 'finished') {
        console.log(`[test] 结束: ${msg.reason}`)
        resolve()
      } else if (msg.type === 'error') {
        console.error(`[test] 错误: ${msg.message}`)
        resolve()
      }
    })
    ws.on('error', (e: Error) => {
      console.error('[test] WS', e.message)
      resolve()
    })
  })
  await Promise.race([done, new Promise<void>((r) => setTimeout(r, 120000))])
  ws.close()

  const final = loadSession(session.id)!
  console.log('\n========== 摘要校验 ==========')
  console.log('A summary:', final.memory.A.summary ? `✅ 有 (${final.memory.A.summary.length}字)` : '❌ 无')
  console.log('B summary:', final.memory.B.summary ? `✅ 有 (${final.memory.B.summary.length}字)` : '❌ 无')
  console.log('A messages (keepRecent=2 应≤少量):', final.memory.A.messages.length)
  console.log('A lastSummarizedRound:', final.memory.A.lastSummarizedRound)
  if (final.memory.A.summary) {
    console.log('A 摘要预览:', final.memory.A.summary.slice(0, 200))
  }
  console.log('看到摘要事件:', summarySeen ? '✅' : '❌')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
