/**
 * Agent SSE 路由集成测试（fastify.inject + 脚本化假 fetch）。
 *
 * 独立成文件的原因：providers.json / library.json 的落盘位置由 config 在模块
 * 加载时按 DATA_DIR 环境变量一次性决定，因此必须先设 env 再动态 import 一切
 * 会读 config 的模块（node:test 每个文件独立进程，不会污染其他测试）。
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* --------------------------- 隔离数据目录（先于一切 config 读取） --------------------------- */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-agent-route-'))
process.env.DATA_DIR = path.join(dataDir, 'sessions')

const PROVIDER_ID = 'prov-agent-route'
fs.writeFileSync(
  path.join(dataDir, 'providers.json'),
  JSON.stringify({
    providers: [
      {
        id: PROVIDER_ID,
        name: '测试 Provider',
        baseUrl: 'https://api.test/v1',
        apiKey: 'sk-test',
        model: 'test-model',
        protocol: 'openai',
        pricing: {
          currency: 'CNY',
          inputPerMTok: 1,
          outputPerMTok: 2,
          cacheHitEnabled: false,
          cacheHitPerMTok: 0,
          cacheWriteEnabled: false,
          cacheWritePerMTok: 0,
        },
      },
    ],
    defaultId: PROVIDER_ID,
  }),
)

const { default: Fastify } = await import('fastify')
const { default: agentRoutes } = await import('../routes/agent.js')

/* --------------------------- 假 fetch 基建 --------------------------- */

const calls: Array<{ url: string; body: Record<string, unknown> }> = []
const originalFetch = globalThis.fetch

function sseResponse(datas: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const d of datas) controller.enqueue(encoder.encode(`data: ${d}\n\n`))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function toolCallRound(callId: string, name: string, argsJson: string): Response {
  const fn = '"function":{"name":"' + name + '","arguments":' + JSON.stringify(argsJson) + '}'
  return sseResponse([
    '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"' + callId + '",' + fn + '}]}}]}',
    '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    '[DONE]',
  ])
}

function textRound(text: string): Response {
  return sseResponse([
    '{"choices":[{"delta":{"content":' + JSON.stringify(text) + '}}]}',
    '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
    '[DONE]',
  ])
}

/** 装一个脚本化假 fetch：每次调用消费一个预置响应 */
function installScriptedFetch(responses: Response[]): void {
  let i = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    calls.push({ url: String(input), body })
    const resp = responses[i]
    i += 1
    if (!resp) throw new Error(`脚本响应已耗尽（第 ${i} 次调用）`)
    return resp
  }) as typeof fetch
}

let app: Awaited<ReturnType<typeof Fastify>>

beforeEach(async () => {
  calls.length = 0
  app = Fastify()
  await app.register(agentRoutes)
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  await app.close()
})

/* --------------------------- 用例 --------------------------- */

test('SSE 主链路：工具真执行 + 事件流 + library.json 落盘', async () => {
  installScriptedFetch([
    toolCallRound(
      'call_1',
      'upsert_character_template',
      '{"name":"小张","description":"高中生","personality":"热血"}',
    ),
    textRound('已创建角色「小张」。'),
  ])

  const resp = await app.inject({
    method: 'POST',
    url: '/api/agent/chat',
    payload: {
      sessionId: 's1',
      text: '帮我建个角色叫小张',
      providerId: PROVIDER_ID,
      model: 'test-model',
    },
  })

  assert.equal(resp.statusCode, 200)
  assert.ok(String(resp.headers['content-type']).includes('text/event-stream'))
  assert.ok(resp.headers['x-accel-buffering'] === 'no')

  const body = resp.body
  assert.ok(body.includes('event: tool_call'), '应下发 tool_call 事件')
  assert.ok(body.includes('upsert_character_template'))
  assert.ok(body.includes('"mutated":true'), '写工具的 tool_result 应带 mutated:true')
  assert.ok(body.includes('event: delta'))
  assert.ok(body.includes('event: assistant'))
  assert.ok(body.includes('"reason":"completed"'))

  // 工具写入落在隔离数据目录的 library.json
  const lib = JSON.parse(fs.readFileSync(path.join(dataDir, 'library.json'), 'utf8')) as {
    characterTemplates: Array<{ name: string }>
  }
  assert.equal(lib.characterTemplates.length, 1)
  assert.equal(lib.characterTemplates[0]!.name, '小张')
})

test('会话延续：同 sessionId 的第二次请求带系统提示词与完整历史', async () => {
  installScriptedFetch([
    toolCallRound('call_1', 'list_character_templates', '{}'),
    textRound('当前还没有角色。'),
    textRound('好的，如需创建请告诉我。'),
  ])

  await app.inject({
    method: 'POST',
    url: '/api/agent/chat',
    payload: { sessionId: 's2', text: '看看有哪些角色', providerId: PROVIDER_ID, model: 'test-model' },
  })
  const resp2 = await app.inject({
    method: 'POST',
    url: '/api/agent/chat',
    payload: { sessionId: 's2', text: '先不用建', providerId: PROVIDER_ID, model: 'test-model' },
  })

  assert.equal(resp2.statusCode, 200)
  assert.equal(calls.length, 3)

  // 第一次请求：系统提示词打头（导演 persona）
  const msgs1 = calls[0]!.body.messages as Array<{ role: string; content?: string }>
  assert.equal(msgs1[0]!.role, 'system')
  assert.ok(String(msgs1[0]!.content).includes('导演'))

  // 第二次请求（第 3 次 fetch）：system + 历史（user/assistant/tool）+ 新 user
  const msgs3 = calls[2]!.body.messages as Array<{ role: string; content?: string }>
  assert.equal(msgs3[0]!.role, 'system')
  const roles = msgs3.map((m) => m.role)
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool', 'assistant', 'user'])
  assert.equal(msgs3.at(-1)!.content, '先不用建')
})

test('Provider 不存在：404 JSON（hijack 之前的普通错误路径）', async () => {
  const resp = await app.inject({
    method: 'POST',
    url: '/api/agent/chat',
    payload: { sessionId: 's3', text: 'hi', providerId: 'nope', model: 'm' },
  })
  assert.equal(resp.statusCode, 404)
  assert.ok(resp.json().error.includes('不存在'))
  assert.equal(calls.length, 0)
})

test('body 校验：缺字段 400', async () => {
  const resp = await app.inject({
    method: 'POST',
    url: '/api/agent/chat',
    payload: { sessionId: '', text: 'hi', providerId: PROVIDER_ID, model: 'm' },
  })
  assert.equal(resp.statusCode, 400)
})
