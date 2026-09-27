/**
 * 适配器 tools 支持单元测试：四协议的工具调用解析（流式分片组装 + 非流式）
 * 与请求侧线格式转换（assistant.toolCalls / tool 消息回传）。
 *
 * 通过 monkey-patch globalThis.fetch 返回假 SSE 流 / 假 JSON，不依赖真实上游。
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { openaiAdapter } from './providers/openai.js'
import { anthropicAdapter } from './providers/anthropic.js'
import { geminiAdapter } from './providers/gemini.js'
import { openaiResponsesAdapter } from './providers/openai-responses.js'
import type { AgentToolSchema, ApiMessage } from '../types/index.js'

/* --------------------------- 测试基建 --------------------------- */

const CONN = {
  baseUrl: 'https://api.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  protocol: 'openai' as const,
}

const TEST_TOOLS: AgentToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'upsert_character_template',
      description: '创建或更新角色模板',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
]

/** 带工具调用回传历史的消息序列（请求侧线格式断言用） */
function agentHistory(): ApiMessage[] {
  return [
    { role: 'system', content: '你是编排助手' },
    { role: 'user', content: '帮我建个角色' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'upsert_character_template', input: { name: '小张' } }] },
    { role: 'tool', content: '已创建角色模板「小张」', toolCallId: 'call_1', name: 'upsert_character_template' },
  ]
}

/** 捕获到的 fetch 调用 */
const calls: Array<{ url: string; body: Record<string, unknown> }> = []
const originalFetch = globalThis.fetch

/** 构造 SSE 响应（把若干 data 行按事件块发出） */
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

/** 构造 JSON 响应（非流式） */
function jsonResponse(json: unknown): Response {
  return new Response(JSON.stringify(json), { status: 200 })
}

beforeEach(() => {
  calls.length = 0
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

/** 装一个假 fetch：记录请求并按 url/路径路由返回预置响应 */
function installFetch(routes: Array<{ match: (url: string) => boolean; respond: (body: Record<string, unknown>) => Response }>): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    calls.push({ url, body })
    for (const r of routes) {
      if (r.match(url)) return r.respond(body)
    }
    throw new Error(`测试未覆盖的请求: ${url}`)
  }) as typeof fetch
}

/* --------------------------- OpenAI（chat/completions） --------------------------- */

test('openai 流式：tool_calls 分片组装 + 正文增量', async () => {
  installFetch([
    {
      match: (url) => url.includes('/chat/completions'),
      respond: () =>
        sseResponse([
          '{"choices":[{"delta":{"content":"好的"}}]}',
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"upsert_character_template","arguments":"{\\"na"}}]}}]}',
          '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"me\\":\\"小张\\"}"}}]}}]}',
          '{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          '[DONE]',
        ]),
    },
  ])
  const chunks: string[] = []
  const result = await openaiAdapter.chatCompletion({
    messages: [{ role: 'user', content: '帮我建个角色' }],
    conn: CONN,
    tools: TEST_TOOLS,
    onContent: (c) => chunks.push(c),
  })
  assert.equal(result.content, '好的')
  assert.deepEqual(chunks, ['好的'])
  assert.deepEqual(result.toolCalls, [
    { id: 'call_1', name: 'upsert_character_template', input: { name: '小张' } },
  ])
  // 请求侧：tools + tool_choice 下发
  const body = calls[0]!.body as { tools?: unknown[]; tool_choice?: string }
  assert.equal(body.tools?.length, 1)
  assert.equal(body.tool_choice, 'auto')
})

test('openai 非流式：tool_calls 完整解析', async () => {
  installFetch([
    {
      match: (url) => url.includes('/chat/completions'),
      respond: () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [{ id: 'call_9', function: { name: 'list_character_templates', arguments: '{}' } }],
              },
            },
          ],
        }),
    },
  ])
  const result = await openaiAdapter.chatComplete({
    messages: [{ role: 'user', content: '列一下角色' }],
    conn: CONN,
    tools: TEST_TOOLS,
  })
  assert.deepEqual(result.toolCalls, [{ id: 'call_9', name: 'list_character_templates', input: {} }])
})

test('openai：坏 arguments 的 tool_call 被丢弃', async () => {
  installFetch([
    {
      match: (url) => url.includes('/chat/completions'),
      respond: () =>
        jsonResponse({
          choices: [
            { message: { content: '', tool_calls: [{ id: 'bad', function: { name: 'x', arguments: '{not json' } }] } },
          ],
        }),
    },
  ])
  const result = await openaiAdapter.chatComplete({ messages: [{ role: 'user', content: 'x' }], conn: CONN, tools: TEST_TOOLS })
  assert.equal(result.toolCalls.length, 0)
})

test('openai：不传 tools 时行为与旧版一致（无 tools 字段、toolCalls 为空）', async () => {
  installFetch([
    {
      match: (url) => url.includes('/chat/completions'),
      respond: () => sseResponse(['{"choices":[{"delta":{"content":"hi"}}]}', '[DONE]']),
    },
  ])
  const result = await openaiAdapter.chatCompletion({ messages: [{ role: 'user', content: 'hi' }], conn: CONN })
  assert.equal(result.content, 'hi')
  assert.deepEqual(result.toolCalls, [])
  assert.equal('tools' in (calls[0]!.body as Record<string, unknown>), false)
})

test('openai 线格式：assistant.toolCalls 与 tool 消息回传', async () => {
  installFetch([
    {
      match: (url) => url.includes('/chat/completions'),
      respond: () => sseResponse(['{"choices":[{"delta":{"content":"done"}}]}', '[DONE]']),
    },
  ])
  await openaiAdapter.chatCompletion({ messages: agentHistory(), conn: CONN, tools: TEST_TOOLS })
  const messages = calls[0]!.body.messages as Array<Record<string, unknown>>
  const assistant = messages.find((m) => m.role === 'assistant') as {
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
  }
  assert.equal(assistant.tool_calls?.[0]?.id, 'call_1')
  assert.equal(assistant.tool_calls?.[0]?.function.name, 'upsert_character_template')
  assert.equal(assistant.tool_calls?.[0]?.function.arguments, '{"name":"小张"}')
  const tool = messages.find((m) => m.role === 'tool') as { tool_call_id?: string; content?: string }
  assert.equal(tool.tool_call_id, 'call_1')
  assert.ok(tool.content?.includes('小张'))
})

/* --------------------------- Anthropic（/v1/messages） --------------------------- */

test('anthropic 流式：tool_use 块 + input_json_delta 分片', async () => {
  installFetch([
    {
      match: (url) => url.includes('/v1/messages'),
      respond: () =>
        sseResponse([
          '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"set_relationship"}}',
          '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"from"}}',
          '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"TemplateId\\":\\"ct_a\\"}"}}',
          '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"已完成"}}',
          '{"type":"message_delta","usage":{"output_tokens":10}}',
        ]),
    },
  ])
  const result = await anthropicAdapter.chatCompletion({
    messages: [
      { role: 'system', content: '你是编排助手' },
      { role: 'user', content: '连个关系' },
    ],
    conn: { ...CONN, protocol: 'anthropic' },
    tools: TEST_TOOLS,
  })
  assert.equal(result.content, '已完成')
  assert.deepEqual(result.toolCalls, [{ id: 'toolu_1', name: 'set_relationship', input: { fromTemplateId: 'ct_a' } }])
  // 请求侧：Anthropic 线格式 tools（input_schema 平铺）
  const body = calls[0]!.body as { tools?: Array<Record<string, unknown>>; system?: string }
  assert.equal(body.tools?.[0]?.name, 'upsert_character_template')
  assert.ok('input_schema' in (body.tools?.[0] ?? {}))
  assert.equal(body.system, '你是编排助手')
})

test('anthropic 线格式：tool_use 块回传 + tool_result 包 user 消息', async () => {
  installFetch([
    {
      match: (url) => url.includes('/v1/messages'),
      respond: () =>
        sseResponse([
          '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
          '{"type":"message_stop"}',
        ]),
    },
  ])
  await anthropicAdapter.chatCompletion({
    messages: agentHistory(),
    conn: { ...CONN, protocol: 'anthropic' },
    tools: TEST_TOOLS,
  })
  const messages = calls[0]!.body.messages as Array<{ role: string; content: unknown }>
  const assistant = messages.find((m) => m.role === 'assistant')!
  const blocks = assistant.content as Array<Record<string, unknown>>
  assert.equal(blocks[0]?.type, 'tool_use')
  assert.equal(blocks[0]?.id, 'call_1')
  const toolMsg = messages.find((m) => m.role === 'user' && Array.isArray(m.content))!
  const toolBlocks = toolMsg.content as Array<Record<string, unknown>>
  assert.equal(toolBlocks[0]?.type, 'tool_result')
  assert.equal(toolBlocks[0]?.tool_use_id, 'call_1')
})

/* --------------------------- Gemini（generateContent） --------------------------- */

test('gemini 流式：functionCall part 整块收集 + 合成 id', async () => {
  installFetch([
    {
      match: (url) => url.includes(':streamGenerateContent'),
      respond: () =>
        sseResponse([
          '{"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_character_templates","args":{"limit":5}}}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":3}}',
        ]),
    },
  ])
  const result = await geminiAdapter.chatCompletion({
    messages: [{ role: 'user', content: '列一下角色' }],
    conn: { ...CONN, protocol: 'gemini' },
    tools: TEST_TOOLS,
  })
  assert.equal(result.content, '')
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0]!.name, 'list_character_templates')
  assert.deepEqual(result.toolCalls[0]!.input, { limit: 5 })
  assert.ok(result.toolCalls[0]!.id.length > 0, 'Gemini 无原生 id，应生成合成 id')
  // 请求侧：functionDeclarations 平铺、剥离 additionalProperties
  const body = calls[0]!.body as { tools?: Array<{ functionDeclarations?: Array<Record<string, unknown>> }> }
  const decl = body.tools?.[0]?.functionDeclarations?.[0]
  assert.equal(decl?.name, 'upsert_character_template')
  const params = decl?.parameters as Record<string, unknown>
  assert.equal('additionalProperties' in params, false)
})

test('gemini 线格式：functionCall / functionResponse 回传', async () => {
  installFetch([
    {
      match: (url) => url.includes(':streamGenerateContent'),
      respond: () => sseResponse(['{"candidates":[{"content":{"parts":[{"text":"done"}]}}]}']),
    },
  ])
  await geminiAdapter.chatCompletion({
    messages: agentHistory(),
    conn: { ...CONN, protocol: 'gemini' },
    tools: TEST_TOOLS,
  })
  const contents = calls[0]!.body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
  const modelMsg = contents.find((c) => c.role === 'model')!
  assert.ok(modelMsg.parts[0]?.functionCall, 'assistant.toolCalls → model functionCall part')
  const fnResp = contents.find((c) => c.parts.some((p) => 'functionResponse' in p))!
  const part = fnResp.parts.find((p) => 'functionResponse' in p)!.functionResponse as { name: string }
  assert.equal(part.name, 'upsert_character_template')
})

/* --------------------------- OpenAI Responses（/responses） --------------------------- */

test('responses 流式：output_item.done 的 function_call 收集', async () => {
  installFetch([
    {
      match: (url) => url.includes('/responses'),
      respond: () =>
        sseResponse([
          '{"type":"response.output_text.delta","delta":"正在处理"}',
          '{"type":"response.output_item.done","item":{"type":"function_call","call_id":"fc_1","name":"delete_topic_template","arguments":"{\\"id\\":\\"tt_1\\"}"}}',
          '{"type":"response.completed","response":{"usage":{"input_tokens":8,"output_tokens":4}}}',
        ]),
    },
  ])
  const result = await openaiResponsesAdapter.chatCompletion({
    messages: [{ role: 'user', content: '删掉那个话题' }],
    conn: { ...CONN, protocol: 'openai-responses' },
    tools: TEST_TOOLS,
  })
  assert.equal(result.content, '正在处理')
  assert.deepEqual(result.toolCalls, [{ id: 'fc_1', name: 'delete_topic_template', input: { id: 'tt_1' } }])
  assert.equal(result.usage.completion_tokens, 4)
  // 请求侧：扁平工具结构（无嵌套 function 键）
  const body = calls[0]!.body as { tools?: Array<Record<string, unknown>> }
  assert.equal(body.tools?.[0]?.name, 'upsert_character_template')
  assert.equal('function' in (body.tools?.[0] ?? {}), false)
})

test('responses 线格式：function_call / function_call_output 回传', async () => {
  installFetch([
    {
      match: (url) => url.includes('/responses'),
      respond: () => sseResponse(['{"type":"response.completed"}']),
    },
  ])
  await openaiResponsesAdapter.chatCompletion({
    messages: agentHistory(),
    conn: { ...CONN, protocol: 'openai-responses' },
    tools: TEST_TOOLS,
  })
  const input = calls[0]!.body.input as Array<Record<string, unknown>>
  const fnCall = input.find((i) => i.type === 'function_call') as { call_id?: string; arguments?: string }
  assert.equal(fnCall.call_id, 'call_1')
  assert.equal(fnCall.arguments, '{"name":"小张"}')
  const fnOut = input.find((i) => i.type === 'function_call_output') as { call_id?: string; output?: string }
  assert.equal(fnOut.call_id, 'call_1')
  assert.ok(fnOut.output?.includes('小张'))
})

test('responses 非流式：output 数组的 function_call 解析', async () => {
  installFetch([
    {
      match: (url) => url.includes('/responses'),
      respond: () =>
        jsonResponse({
          output: [
            { type: 'function_call', call_id: 'fc_2', name: 'list_worldview_templates', arguments: '{}' },
          ],
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
    },
  ])
  const result = await openaiResponsesAdapter.chatComplete({
    messages: [{ role: 'user', content: '世界观列表' }],
    conn: { ...CONN, protocol: 'openai-responses' },
    tools: TEST_TOOLS,
  })
  assert.deepEqual(result.toolCalls, [{ id: 'fc_2', name: 'list_worldview_templates', input: {} }])
})
