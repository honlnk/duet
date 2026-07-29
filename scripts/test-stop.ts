// 停止功能测试：启动无限对话 -> 1.5s 后发 stop -> 校验立即停止
import { createSession, saveSession, loadSession } from '../server/src/store/sessionStore.js'
import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://localhost:3001'

async function main() {
  const session = createSession({
    topic: '宇宙的终极意义（无限讨论，测试停止）',
    agents: [
      { name: '哲学家', persona: '你从存在主义角度思考。' },
      { name: '科学家', persona: '你从物理实证角度思考。' },
    ],
    config: { maxRounds: 0, temperature: 0.7, summaryEveryN: 50, keepRecent: 8 }, // 无限
  })
  saveSession(session)
  console.log(`[test] 会话: ${session.id} (maxRounds=0 无限)`)

  const ws = new WebSocket(`${WS_URL}/ws/chat?sessionId=${session.id}`)
  let chunkCount = 0
  const done = new Promise<void>((resolve) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'start' })))
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown }
      if (msg.type === 'chunk') {
        chunkCount++
        if (chunkCount === 1) console.log('[test] 收到第一个 chunk，准备 1.5s 后停止')
      } else if (msg.type === 'message_done') {
        const m = msg.message as { content: string; truncated: boolean }
        console.log(`[test] 消息完成: ${msg.agentId} (${m.content.length}字, truncated=${m.truncated})`)
      } else if (msg.type === 'finished') {
        console.log(`[test] 对话结束: ${msg.reason}`)
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

  // 收到第一个 chunk 后 1.5s 发停止
  const stopTimer = setInterval(() => {
    if (chunkCount > 0) {
      clearInterval(stopTimer)
      setTimeout(() => {
        console.log('[test] 发送 stop')
        ws.send(JSON.stringify({ type: 'stop' }))
      }, 1500)
    }
  }, 200)

  await Promise.race([done, new Promise<void>((r) => setTimeout(r, 60000))])
  clearInterval(stopTimer)
  ws.close()

  const final = loadSession(session.id)!
  console.log('\n========== 停止校验 ==========')
  console.log('status:', final.status, final.status === 'stopped' ? '✅' : '❌')
  console.log('finishedReason:', final.finishedReason, final.finishedReason === 'stopped' ? '✅' : '❌')
  console.log('messageCount:', final.messageCount)
  console.log('stoppedAt 已设置:', final.stoppedAt ? '✅' : '❌')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
