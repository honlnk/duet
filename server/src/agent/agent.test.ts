/**
 * Agent 循环核心单元测试：runAgentQuery 的完整工具轮回（脚本化假 fetch）
 * + 工具执行层的失败回灌兜底 + 会话态存取与过期清理。
 *
 * 不依赖真实上游：globalThis.fetch 按调用次序返回预置 SSE 流，
 * 工具执行落在隔离的临时 libraryStore 上，可断言真实写入。
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ApiMessage, ConnectionConfig } from '../types/index.js'
import { _resetForTest, listCharacterTemplates } from '../store/libraryStore.js'
import { runAgentQuery, type AgentLoopEvent } from './query.js'
import {
  _resetAgentSessions,
  agentSessionCount,
  getAgentSession,
} from './messages.js'

/* --------------------------- 测试基建 --------------------------- */

const CONN: ConnectionConfig = {
  baseUrl: 'https://api.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  protocol: 'openai',
}

/** 捕获到的 fetch 请求 */
const calls: Array<{ url: string; body: Record<string, unknown> }> = []
const originalFetch = globalThis.fetch

/** 构造 SSE 响应 */
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

/** OpenAI 线格式：一轮带单个工具调用的流式响应 */
function toolCallRound(callId: string, name: string, argsJson: string, content = ''): Response {
  const datas: string[] = []
  if (content) {
    datas.push('{"choices":[{"delta":{"content":' + JSON.stringify(content) + '}}]}')
  }
  const fn = '"function":{"name":"' + name + '","arguments":' + JSON.stringify(argsJson) + '}'
  datas.push('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"' + callId + '",' + fn + '}]}}]}')
  datas.push('{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}')
  datas.push('[DONE]')
  return sseResponse(datas)
}

/** OpenAI 线格式：一轮纯文本流式响应 */
function textRound(text: string): Response {
  const textData = '{"choices":[{"delta":{"content":' + JSON.stringify(text) + '}}]}'
  return sseResponse([
    textData,
    '{"choices":[{"delta":{},"finish_reason":"stop"}]}',
    '[DONE]',
  ])
}

function freshMessages(): ApiMessage[] {
  return [{ role: 'user', content: '帮我建个角色' }]
}

beforeEach(() => {
  calls.length = 0
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-agent-test-'))
  _resetForTest(path.join(dir, 'library.json'))
  _resetAgentSessions()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

/* --------------------------- 主链路：工具轮 → 真执行 → 回灌 → 文本收尾 --------------------------- */

test('完整工具轮回：tool_call 写入 libraryStore → 结果回灌 → 第二轮纯文本收尾', async () => {
  installScriptedFetch([
    toolCallRound(
      'call_1',
      'upsert_character_template',
      '{"name":"小张","description":"高中生，爱打篮球","personality":"热血"}',
      '我先创建这个角色。',
    ),
    textRound('已创建角色「小张」，需要我再补充关系吗？'),
  ])

  const messages = freshMessages()
  const events: AgentLoopEvent[] = []
  await runAgentQuery({
    messages,
    conn: CONN,
    onEvent: (e) => events.push(e),
  })

  // 资产库真实写入
  const list = listCharacterTemplates()
  assert.equal(list.length, 1)
  assert.equal(list[0]!.name, '小张')
  assert.equal(list[0]!.description, '高中生，爱打篮球')

  // 事件序列
  const toolCall = events.find((e) => e.type === 'tool_call')
  assert.ok(toolCall && toolCall.type === 'tool_call')
  assert.equal(toolCall.name, 'upsert_character_template')
  assert.deepEqual(toolCall.args, { id: '', name: '小张', description: '高中生，爱打篮球', personality: '热血' })

  const toolResult = events.find((e) => e.type === 'tool_result')
  assert.ok(toolResult && toolResult.type === 'tool_result')
  assert.equal(toolResult.ok, true)
  assert.equal(toolResult.mutated, true, '写操作工具应标记 mutated')

  const assistant = events.find((e) => e.type === 'assistant')
  assert.ok(assistant && assistant.type === 'assistant')
  assert.equal(assistant.content, '已创建角色「小张」，需要我再补充关系吗？')

  const done = events.at(-1)
  assert.ok(done && done.type === 'done')
  assert.equal(done.reason, 'completed')

  // 两轮 LLM 调用
  assert.equal(calls.length, 2)

  // 第二轮请求：assistant.toolCalls / tool 消息以 OpenAI 线格式回传，且带全量工具表
  const msgs2 = calls[1]!.body.messages as Array<Record<string, unknown>>
  assert.equal(msgs2[0]!.role, 'user')
  assert.equal(msgs2[1]!.role, 'assistant')
  const wireCalls = msgs2[1]!.tool_calls as Array<Record<string, unknown>>
  assert.equal(wireCalls[0]!.id, 'call_1')
  const fn = wireCalls[0]!.function as { name: string; arguments: string }
  assert.equal(fn.name, 'upsert_character_template')
  assert.equal(JSON.parse(fn.arguments).name, '小张')
  assert.equal(msgs2[2]!.role, 'tool')
  assert.equal(msgs2[2]!.tool_call_id, 'call_1')
  assert.ok(String(msgs2[2]!.content).includes('已创建角色模板'))
  const tools = calls[1]!.body.tools as unknown[]
  assert.equal(tools.length, 12)
  assert.equal(calls[1]!.body.tool_choice, 'auto')

  // 会话消息数组原地追加：user → assistant(toolCalls) → tool → assistant
  assert.equal(messages.length, 4)
  assert.equal(messages[1]!.role, 'assistant')
  assert.deepEqual(messages[1]!.toolCalls?.map((c) => c.name), ['upsert_character_template'])
  assert.equal(messages[2]!.role, 'tool')
  assert.equal(messages[2]!.toolCallId, 'call_1')
  assert.equal(messages[3]!.role, 'assistant')
  assert.equal(messages[3]!.content, '已创建角色「小张」，需要我再补充关系吗？')
})

/* --------------------------- 失败回灌：不崩循环，模型自纠 --------------------------- */

test('未知工具：回灌提示文本，循环继续并正常收尾', async () => {
  installScriptedFetch([
    toolCallRound('call_x', 'hack_the_planet', '{}'),
    textRound('抱歉，我换正确的工具重试。'),
  ])

  const messages = freshMessages()
  const events: AgentLoopEvent[] = []
  await runAgentQuery({ messages, conn: CONN, onEvent: (e) => events.push(e) })

  const toolResult = events.find((e) => e.type === 'tool_result')
  assert.ok(toolResult && toolResult.type === 'tool_result')
  assert.equal(toolResult.ok, false)
  assert.equal(toolResult.mutated, false)
  assert.ok(toolResult.summary.includes('未知工具'))

  // 失败文本作为 tool 消息回灌（序列合法：tool_call 恒有配对 result）
  assert.equal(messages[2]!.role, 'tool')
  assert.ok(String(messages[2]!.content).includes('未知工具'))
  assert.ok(String(messages[2]!.content).includes('upsert_character_template'), '应列出可用工具名')

  const last1 = events.at(-1)
  assert.ok(last1 && last1.type === 'done')
  assert.equal(last1.reason, 'completed')
  assert.equal(calls.length, 2)
})

test('参数校验失败：回灌错误文本，循环继续并正常收尾', async () => {
  installScriptedFetch([
    toolCallRound('call_v', 'upsert_character_template', '{}'), // 缺必填的 name
    textRound('我补上角色名再来一次。'),
  ])

  const messages = freshMessages()
  const events: AgentLoopEvent[] = []
  await runAgentQuery({ messages, conn: CONN, onEvent: (e) => events.push(e) })

  const toolResult = events.find((e) => e.type === 'tool_result')
  assert.ok(toolResult && toolResult.type === 'tool_result')
  assert.equal(toolResult.ok, false)
  assert.ok(toolResult.summary.includes('参数校验失败'))
  assert.ok(String(messages[2]!.content).includes('参数校验失败'))
  assert.equal(listCharacterTemplates().length, 0, '校验失败不应写入')
  const last2 = events.at(-1)
  assert.ok(last2 && last2.type === 'done')
  assert.equal(last2.reason, 'completed')
})

test('执行失败（更新不存在的 id）：回灌错误文本，不崩循环', async () => {
  installScriptedFetch([
    toolCallRound('call_e', 'upsert_character_template', '{"id":"ct_none","name":"小张"}'),
    textRound('这个 id 不存在，我改用新建。'),
  ])

  const messages = freshMessages()
  const events: AgentLoopEvent[] = []
  await runAgentQuery({ messages, conn: CONN, onEvent: (e) => events.push(e) })

  const toolResult = events.find((e) => e.type === 'tool_result')
  assert.ok(toolResult && toolResult.type === 'tool_result')
  assert.equal(toolResult.ok, false)
  assert.ok(String(messages[2]!.content).includes('执行失败'))
  const last3 = events.at(-1)
  assert.ok(last3 && last3.type === 'done')
  assert.equal(last3.reason, 'completed')
})

/* --------------------------- 安全阀：轮次上限与中止 --------------------------- */

test('maxTurns 触发：工具轮后达到上限，优雅收尾 turn_limit', async () => {
  installScriptedFetch([
    toolCallRound('call_t1', 'list_character_templates', '{}'),
    toolCallRound('call_t2', 'list_topic_templates', '{}'),
  ])

  const messages = freshMessages()
  const events: AgentLoopEvent[] = []
  await runAgentQuery({ messages, conn: CONN, maxTurns: 1, onEvent: (e) => events.push(e) })

  assert.equal(calls.length, 1, '只应有 1 次 LLM 调用')
  const done = events.at(-1)
  assert.ok(done && done.type === 'done')
  assert.equal(done.reason, 'turn_limit')
})

test('预中止 signal：零 LLM 调用，直接 done(aborted)', async () => {
  const abort = new AbortController()
  abort.abort()

  const events: AgentLoopEvent[] = []
  await runAgentQuery({
    messages: freshMessages(),
    conn: CONN,
    signal: abort.signal,
    onEvent: (e) => events.push(e),
  })

  assert.deepEqual(events.map((e) => e.type), ['done'])
  const only = events[0]
  assert.ok(only && only.type === 'done')
  assert.equal(only.reason, 'aborted')
  assert.equal(calls.length, 0)
})

test('工具批次中中止：后续工具跳过并补占位 tool 消息，序列仍合法', async () => {
  const fnA = '"function":{"name":"upsert_character_template","arguments":' + JSON.stringify('{"name":"小张"}') + '}'
  const fnB = '"function":{"name":"upsert_character_template","arguments":' + JSON.stringify('{"name":"小美"}') + '}'
  installScriptedFetch([
    sseResponse([
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a",' + fnA + '}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b",' + fnB + '}]}}]}',
      '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      '[DONE]',
    ]),
  ])

  const abort = new AbortController()
  const messages = freshMessages()
  const events: AgentLoopEvent[] = []
  await runAgentQuery({
    messages,
    conn: CONN,
    signal: abort.signal,
    onEvent: (e) => {
      events.push(e)
      // 第一个工具执行完成后用户点停止
      if (e.type === 'tool_result') abort.abort()
    },
  })

  // 第一个工具已执行，第二个被跳过
  assert.equal(listCharacterTemplates().length, 1)
  assert.equal(listCharacterTemplates()[0]!.name, '小张')
  const skipped = messages.filter((m) => m.role === 'tool' && m.content.includes('跳过'))
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0]!.toolCallId, 'call_b')
  const done = events.at(-1)
  assert.ok(done && done.type === 'done')
  assert.equal(done.reason, 'aborted')
})

/* --------------------------- 会话态 --------------------------- */

test('会话存取：同 id 返回同一数组引用，计数正确', () => {
  const a1 = getAgentSession('a')
  a1.push({ role: 'user', content: 'x' })
  const a2 = getAgentSession('a')
  assert.ok(a1 === a2, '同 id 应复用同一消息数组')
  assert.equal(a2.length, 1)
  getAgentSession('b')
  assert.equal(agentSessionCount(), 2)
  _resetAgentSessions()
  assert.equal(agentSessionCount(), 0)
})

test('会话过期：超过 2h 空闲的会话被惰性清理', () => {
  const realNow = Date.now
  let fake = realNow()
  Date.now = () => fake
  try {
    _resetAgentSessions()
    getAgentSession('old')
    fake += 3 * 60 * 60 * 1000 // 快进 3 小时
    getAgentSession('new') // 触发 sweep
    assert.equal(agentSessionCount(), 1, 'old 会话应已过期清理')
    assert.equal(getAgentSession('old').length, 0, '过期后重建为空会话')
  } finally {
    Date.now = realNow
  }
})
