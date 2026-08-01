/**
 * 多智能体单元测试（node:test）
 *
 * 纯逻辑验证：不依赖真实网络/Provider，覆盖
 *  - createSession 支持 2/3 智能体与默认颜色分配
 *  - nextAgentId 循环顺序（2/3 智能体）
 *  - currentRound 按智能体数计算
 *  - AgentMemory 多对手视角（others 数组、buildApiMessages）
 *  - 旧数据归一化（v1 other → v2 others）
 *
 * 运行：node --import tsx --test server/src/multi-agent.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// 在导入依赖 config 的模块前，先把 DATA_DIR 指向临时目录，
// 避免污染真实 data/sessions。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-test-'))
process.env.DATA_DIR = tmpDir

const { createSession, nextAgentId, currentRound } = await import(
  './store/sessionStore.js'
)
const { AgentMemory } = await import('./memory/context.js')
const { buildAgentSystem } = await import('./ai/prompts.js')

/* --------------------------- createSession --------------------------- */

test('createSession：2 智能体，默认颜色 蓝/粉', () => {
  const s = createSession({
    topic: '测试话题',
    agents: [
      { name: '猫派', persona: '我喜欢猫' },
      { name: '狗派', persona: '我喜欢狗' },
    ],
  })
  assert.equal(s.agents.length, 2)
  assert.equal(s.agents[0]!.id, 'A')
  assert.equal(s.agents[1]!.id, 'B')
  assert.equal(s.agents[0]!.color, 'blue')
  assert.equal(s.agents[1]!.color, 'pink')
  assert.equal(s.currentAgentId, 'A')
  assert.equal(s.messageCount, 0)
  // memory.A/B 必有，C 不存在
  assert.ok(s.memory.A)
  assert.ok(s.memory.B)
  assert.equal(s.memory.C, undefined)
})

test('createSession：3 智能体，默认颜色 蓝/粉/绿，memory.C 存在', () => {
  const s = createSession({
    topic: '三方讨论',
    agents: [
      { name: 'A', persona: 'a' },
      { name: 'B', persona: 'b' },
      { name: 'C', persona: 'c' },
    ],
  })
  assert.equal(s.agents.length, 3)
  assert.equal(s.agents[2]!.id, 'C')
  assert.equal(s.agents[2]!.color, 'green')
  assert.ok(s.memory.C, '三智能体 memory.C 应存在')
  // C 的 others 应包含 A 和 B
  const cOthers = s.memory.C.others.map((o) => o.id)
  assert.deepEqual([...cOthers].sort(), ['A', 'B'])
})

test('createSession：用户自定义颜色覆盖默认', () => {
  const s = createSession({
    topic: '自定义颜色',
    agents: [
      { name: 'X', persona: '', color: 'purple' },
      { name: 'Y', persona: '', color: 'teal' },
    ],
  })
  assert.equal(s.agents[0]!.color, 'purple')
  assert.equal(s.agents[1]!.color, 'teal')
})

test('createSession：5 智能体（A-E），memory 全存在，默认色循环', () => {
  const s = createSession({
    topic: '五方讨论',
    agents: [
      { name: '甲', persona: '' },
      { name: '乙', persona: '' },
      { name: '丙', persona: '' },
      { name: '丁', persona: '' },
      { name: '戊', persona: '' },
    ],
  })
  assert.equal(s.agents.length, 5)
  assert.equal(s.agents[3]!.id, 'D')
  assert.equal(s.agents[4]!.id, 'E')
  // 默认色循环：blue/pink/green/amber/purple
  assert.equal(s.agents[3]!.color, 'amber')
  assert.equal(s.agents[4]!.color, 'purple')
  // memory 应全部存在
  assert.ok(s.memory.D, 'memory.D 应存在')
  assert.ok(s.memory.E, 'memory.E 应存在')
  // E 的 others 应有 4 个（A/B/C/D）
  assert.equal(s.memory.E.others.length, 4)
})

test('createSession：自定义 hex 颜色（#ff5533）透传存储', () => {
  const s = createSession({
    topic: 'hex 颜色',
    agents: [
      { name: 'X', persona: '', color: '#ff5533' },
      { name: 'Y', persona: '', color: '#abc' },
    ],
  })
  assert.equal(s.agents[0]!.color, '#ff5533')
  assert.equal(s.agents[1]!.color, '#abc')
})

test('createSession：缺省 name 时按字母补默认名', () => {
  const s = createSession({
    topic: 't',
    agents: [{ name: '', persona: '' }, { name: '', persona: '' }],
  })
  assert.equal(s.agents[0]!.name, '智能体 A')
  assert.equal(s.agents[1]!.name, '智能体 B')
})

test('createSession：memory 视角隔离——A 的 others 不含自己', () => {
  const s = createSession({
    topic: '隔离测试',
    agents: [
      { name: '甲', persona: 'p1' },
      { name: '乙', persona: 'p2' },
      { name: '丙', persona: 'p3' },
    ],
  })
  // A 的 others 应是 [乙, 丙]，不含甲
  const aOtherNames = s.memory.A.others.map((o) => o.name)
  assert.deepEqual(aOtherNames, ['乙', '丙'])
  // B 的 others 应是 [甲, 丙]
  const bOtherNames = s.memory.B.others.map((o) => o.name)
  assert.deepEqual(bOtherNames, ['甲', '丙'])
})

/* --------------------------- nextAgentId 循环 --------------------------- */

test('nextAgentId：2 智能体 A→B→A 循环', () => {
  const s = createSession({
    topic: 't',
    agents: [{ name: 'A', persona: '' }, { name: 'B', persona: '' }],
  })
  s.currentAgentId = 'A'
  assert.equal(nextAgentId(s), 'B')
  s.currentAgentId = 'B'
  assert.equal(nextAgentId(s), 'A')
})

test('nextAgentId：3 智能体 A→B→C→A 循环', () => {
  const s = createSession({
    topic: 't',
    agents: [
      { name: 'A', persona: '' },
      { name: 'B', persona: '' },
      { name: 'C', persona: '' },
    ],
  })
  s.currentAgentId = 'A'
  assert.equal(nextAgentId(s), 'B')
  s.currentAgentId = 'B'
  assert.equal(nextAgentId(s), 'C')
  s.currentAgentId = 'C'
  assert.equal(nextAgentId(s), 'A')
})

test('nextAgentId：5 智能体 A→B→C→D→E→A 循环', () => {
  const s = createSession({
    topic: 't',
    agents: [
      { name: 'A', persona: '' },
      { name: 'B', persona: '' },
      { name: 'C', persona: '' },
      { name: 'D', persona: '' },
      { name: 'E', persona: '' },
    ],
  })
  s.currentAgentId = 'C'
  assert.equal(nextAgentId(s), 'D')
  s.currentAgentId = 'E'
  assert.equal(nextAgentId(s), 'A')
})

/* --------------------------- currentRound --------------------------- */

test('currentRound：2 智能体时 2 条/轮', () => {
  const s = createSession({
    topic: 't',
    agents: [{ name: 'A', persona: '' }, { name: 'B', persona: '' }],
  })
  s.messageCount = 0
  assert.equal(currentRound(s), 0)
  s.messageCount = 1
  assert.equal(currentRound(s), 0)
  s.messageCount = 2
  assert.equal(currentRound(s), 1)
  s.messageCount = 4
  assert.equal(currentRound(s), 2)
})

test('currentRound：3 智能体时 3 条/轮', () => {
  const s = createSession({
    topic: 't',
    agents: [
      { name: 'A', persona: '' },
      { name: 'B', persona: '' },
      { name: 'C', persona: '' },
    ],
  })
  s.messageCount = 2
  assert.equal(currentRound(s), 0)
  s.messageCount = 3
  assert.equal(currentRound(s), 1)
  s.messageCount = 6
  assert.equal(currentRound(s), 2)
})

/* --------------------------- AgentMemory --------------------------- */

test('AgentMemory：多对手 buildApiMessages 含 system + 所有对手名', () => {
  const me = { id: 'A' as const, name: '甲', persona: '我是甲' }
  const others = [
    { id: 'B' as const, name: '乙', persona: 'b' },
    { id: 'C' as const, name: '丙', persona: 'c' },
  ]
  const mem = new AgentMemory(me, others, '话题')
  mem.pushSelf('我说了一句')
  mem.pushOther('[乙]: 乙说的')
  mem.pushOther('[丙]: 丙说的')

  const msgs = mem.buildApiMessages(8)
  // system + 3 条消息
  assert.equal(msgs.length, 4)
  assert.equal(msgs[0]!.role, 'system')
  // system 应同时包含两个对手名
  const sys = msgs[0]!.content
  assert.ok(sys.includes('乙'), 'system 应含对手「乙」')
  assert.ok(sys.includes('丙'), 'system 应含对手「丙」')
  // 自己的发言是 assistant，对方是 user
  assert.equal(msgs[1]!.role, 'assistant')
  assert.equal(msgs[2]!.role, 'user')
  assert.equal(msgs[3]!.role, 'user')
})

test('AgentMemory：toJSON/fromJSON 往返保持 others', () => {
  const me = { id: 'A' as const, name: '甲', persona: 'p' }
  const others = [
    { id: 'B' as const, name: '乙', persona: '' },
    { id: 'C' as const, name: '丙', persona: '' },
  ]
  const mem = new AgentMemory(me, others, 't')
  mem.pushSelf('hi')
  mem.summary = '旧摘要'

  const json = mem.toJSON()
  assert.equal(json.others.length, 2)

  const restored = AgentMemory.fromJSON(json)
  assert.equal(restored.others.length, 2)
  assert.equal(restored.summary, '旧摘要')
  assert.equal(restored.messages.length, 1)
})

test('AgentMemory：trimToRecent 裁剪到最近 N 条', () => {
  const mem = new AgentMemory(
    { id: 'A', name: '甲', persona: '' },
    [{ id: 'B', name: '乙', persona: '' }],
    't',
  )
  for (let i = 0; i < 10; i++) mem.pushSelf(`第${i}句`)
  mem.trimToRecent(3)
  assert.equal(mem.messages.length, 3)
  assert.equal(mem.messages[0]!.content, '第7句')
})

/* --------------------------- buildAgentSystem --------------------------- */

test('buildAgentSystem：单对手时用「与 X 一对一」措辞', () => {
  const sys = buildAgentSystem({
    name: '甲',
    persona: 'p',
    otherNames: ['乙'],
    topic: '话题',
  })
  assert.ok(sys.includes('乙'))
})

test('buildAgentSystem：多对手时列出所有参与者', () => {
  const sys = buildAgentSystem({
    name: '甲',
    persona: 'p',
    otherNames: ['乙', '丙'],
    topic: '话题',
  })
  assert.ok(sys.includes('乙'))
  assert.ok(sys.includes('丙'))
  // 多人时应有「轮流发言」相关提示
  assert.ok(sys.includes('轮流'))
})

/* --------------------------- 旧数据归一化 --------------------------- */

test('loadSession：v1 旧数据（other 单个字段）归一化为 others 数组', async () => {
  const { saveSession, loadSession } = await import('./store/sessionStore.js')
  const oldSession = {
    id: 'sess_legacy_test',
    topic: '旧会话',
    agents: [
      { id: 'A', name: '甲', persona: 'p', color: 'blue' },
      { id: 'B', name: '乙', persona: 'p', color: 'pink' },
    ],
    config: {
      maxRounds: 0,
      durationSec: 0,
      model: 'x',
      temperature: 0.7,
      summaryEveryN: 10,
      keepRecent: 8,
    },
    status: 'idle' as const,
    finishedReason: null,
    startedAt: null,
    stoppedAt: null,
    messageCount: 0,
    currentAgentId: 'A' as const,
    messages: [],
    // v1 旧格式：other 单个对象
    memory: {
      A: {
        agent: { id: 'A', name: '甲', persona: 'p' },
        other: { id: 'B', name: '乙', persona: 'p' }, // 旧字段
        topic: '旧会话',
        messages: [],
        summary: '',
        lastSummarizedRound: 0,
      },
      B: {
        agent: { id: 'B', name: '乙', persona: 'p' },
        other: { id: 'A', name: '甲', persona: 'p' },
        topic: '旧会话',
        messages: [],
        summary: '',
        lastSummarizedRound: 0,
      },
    },
    stats: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCacheHitTokens: 0,
      totalCacheMissTokens: 0,
      totalCacheWriteTokens: 0,
      estCost: 0,
      costCurrency: '',
      totalChars: 0,
    },
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  saveSession(oldSession as any)
  const loaded = loadSession('sess_legacy_test')
  assert.ok(loaded, '应能加载')
  // other 应被转成 others 数组
  assert.ok(Array.isArray(loaded!.memory.A.others), 'A.others 应为数组')
  assert.equal(loaded!.memory.A.others.length, 1)
  assert.equal(loaded!.memory.A.others[0]!.id, 'B')
  // 旧 other 字段应被删除
  assert.equal((loaded!.memory.A as any).other, undefined)
})

/* --------------------------- 清理 --------------------------- */

test('清理临时目录', () => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  assert.ok(true)
})
