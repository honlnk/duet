/**
 * 多智能体单元测试（node:test）
 *
 * 纯逻辑验证：不依赖真实网络/Provider，覆盖
 *  - createSession 支持 2/3 智能体与默认颜色分配
 *  - nextAgentId 循环顺序（2/3 智能体）
 *  - currentRound 按智能体数计算
 *  - AgentMemory 多对手视角（others 数组、buildApiMessages）
 *  - 结构化角色卡（description + personality）
 *  - 非对称关系图（relationships）
 *  - 全局提示词（scenario + globalPrompt）
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
      { name: '猫派', description: '我喜欢猫' },
      { name: '狗派', description: '我喜欢狗' },
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
      { name: 'A', description: 'a' },
      { name: 'B', description: 'b' },
      { name: 'C', description: 'c' },
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
      { name: 'X', color: 'purple' },
      { name: 'Y', color: 'teal' },
    ],
  })
  assert.equal(s.agents[0]!.color, 'purple')
  assert.equal(s.agents[1]!.color, 'teal')
})

test('createSession：5 智能体（A-E），memory 全存在，默认色循环', () => {
  const s = createSession({
    topic: '五方讨论',
    agents: [
      { name: '甲' },
      { name: '乙' },
      { name: '丙' },
      { name: '丁' },
      { name: '戊' },
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
      { name: 'X', color: '#ff5533' },
      { name: 'Y', color: '#abc' },
    ],
  })
  assert.equal(s.agents[0]!.color, '#ff5533')
  assert.equal(s.agents[1]!.color, '#abc')
})

test('createSession：缺省 name 时按字母补默认名', () => {
  const s = createSession({
    topic: 't',
    agents: [{ name: '' }, { name: '' }],
  })
  assert.equal(s.agents[0]!.name, '智能体 A')
  assert.equal(s.agents[1]!.name, '智能体 B')
})

test('createSession：memory 视角隔离——A 的 others 不含自己', () => {
  const s = createSession({
    topic: '隔离测试',
    agents: [
      { name: '甲', description: 'p1' },
      { name: '乙', description: 'p2' },
      { name: '丙', description: 'p3' },
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
    agents: [{ name: 'A' }, { name: 'B' }],
  })
  s.currentAgentId = 'A'
  assert.equal(nextAgentId(s), 'B')
  s.currentAgentId = 'B'
  assert.equal(nextAgentId(s), 'A')
})

test('nextAgentId：3 智能体 A→B→C→A 循环', () => {
  const s = createSession({
    topic: 't',
    agents: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
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
      { name: 'A' },
      { name: 'B' },
      { name: 'C' },
      { name: 'D' },
      { name: 'E' },
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
    agents: [{ name: 'A' }, { name: 'B' }],
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
    agents: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
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
  const me = { id: 'A' as const, name: '甲', description: '我是甲' }
  const others = [
    { id: 'B' as const, name: '乙', description: 'b' },
    { id: 'C' as const, name: '丙', description: 'c' },
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
  const me = { id: 'A' as const, name: '甲' }
  const others = [
    { id: 'B' as const, name: '乙' },
    { id: 'C' as const, name: '丙' },
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
    { id: 'A', name: '甲' },
    [{ id: 'B', name: '乙' }],
    't',
  )
  for (let i = 0; i < 10; i++) mem.pushSelf(`第${i}句`)
  mem.trimToRecent(3)
  assert.equal(mem.messages.length, 3)
  assert.equal(mem.messages[0]!.content, '第7句')
})

/* --------------------------- buildAgentSystem --------------------------- */

test('buildAgentSystem：单对手时列出参与者', () => {
  const sys = buildAgentSystem({
    name: '甲',
    description: 'd',
    others: [{ id: 'B', name: '乙' }],
    topic: '话题',
  })
  assert.ok(sys.includes('乙'))
})

test('buildAgentSystem：多对手时列出所有参与者', () => {
  const sys = buildAgentSystem({
    name: '甲',
    description: 'd',
    others: [
      { id: 'B', name: '乙' },
      { id: 'C', name: '丙' },
    ],
    topic: '话题',
  })
  assert.ok(sys.includes('乙'))
  assert.ok(sys.includes('丙'))
  // 多人时应有「轮流发言」相关提示
  assert.ok(sys.includes('轮流'))
})

/* --------------------------- 结构化角色卡 --------------------------- */

test('createSession：description + personality 透传存储', () => {
  const s = createSession({
    topic: 't',
    agents: [
      { name: '甲', description: '阳光男孩', personality: '开朗' },
      { name: '乙', description: '温柔女孩', personality: '善良' },
    ],
  })
  assert.equal(s.agents[0]!.description, '阳光男孩')
  assert.equal(s.agents[0]!.personality, '开朗')
  assert.equal(s.agents[1]!.description, '温柔女孩')
  assert.equal(s.agents[1]!.personality, '善良')
  // memory 中也透传
  assert.equal(s.memory.A.agent.description, '阳光男孩')
  assert.equal(s.memory.A.agent.personality, '开朗')
  assert.equal(s.memory.B.others[0]!.description, '阳光男孩')
})

test('buildAgentSystem：主角 description + personality 注入', () => {
  const sys = buildAgentSystem({
    name: '小张',
    description: '阳光帅气，打篮球',
    personality: '开朗爱调侃',
    others: [{ id: 'B', name: '小美' }],
    topic: '校园日常',
  })
  assert.ok(sys.includes('阳光帅气'), '应含 description')
  assert.ok(sys.includes('开朗爱调侃'), '应含 personality')
  assert.ok(sys.includes('小张'), '应含主角名')
})

test('buildAgentSystem：他人 description 注入到在场角色', () => {
  const sys = buildAgentSystem({
    name: '小张',
    description: '主角',
    others: [
      { id: 'B', name: '小美', description: '漂亮温柔，学习好', personality: '可爱' },
    ],
    topic: 't',
  })
  assert.ok(sys.includes('小美'), '应含他人名')
  assert.ok(sys.includes('漂亮温柔'), '应含他人 description')
  assert.ok(sys.includes('可爱'), '应含他人 personality')
})

/* --------------------------- 非对称关系图 --------------------------- */

test('createSession：relationships 透传到 session 和 memory', () => {
  const rels = {
    'A->B': '小美是我的同桌',
    'B->A': '小张是我的Crush',
  }
  const s = createSession({
    topic: 't',
    agents: [
      { name: '小张', description: 'd' },
      { name: '小美', description: 'd' },
    ],
    relationships: rels,
  })
  assert.deepEqual(s.relationships, rels)
  assert.deepEqual(s.memory.A.relationships, rels)
  assert.deepEqual(s.memory.B.relationships, rels)
})

test('AgentMemory：extractMyRelationships 注入到 system prompt（非对称）', () => {
  const rels = {
    'A->B': '小美是我的同桌，暗恋我',
    'B->A': '小张是我的Crush',
  }
  const memA = new AgentMemory(
    { id: 'A', name: '小张', description: '主角' },
    [{ id: 'B', name: '小美', description: '对方' }],
    't',
    rels,
  )
  const msgsA = memA.buildApiMessages(8)
  const sysA = msgsA[0]!.content
  // A 视角应含 A->B 关系，不含 B->A
  assert.ok(sysA.includes('同桌'), 'A 应含 A→B 关系')
  assert.ok(!sysA.includes('Crush'), 'A 不应含 B→A 关系（非对称）')

  const memB = new AgentMemory(
    { id: 'B', name: '小美', description: '主角' },
    [{ id: 'A', name: '小张', description: '对方' }],
    't',
    rels,
  )
  const msgsB = memB.buildApiMessages(8)
  const sysB = msgsB[0]!.content
  // B 视角应含 B->A 关系，不含 A->B
  assert.ok(sysB.includes('Crush'), 'B 应含 B→A 关系')
  assert.ok(!sysB.includes('暗恋'), 'B 不应含 A→B 关系（非对称）')
})

test('AgentMemory：toJSON/fromJSON 往返保持 relationships', () => {
  const rels = { 'A->B': '关系A' }
  const mem = new AgentMemory(
    { id: 'A', name: '甲' },
    [{ id: 'B', name: '乙' }],
    't',
    rels,
  )
  const json = mem.toJSON()
  assert.deepEqual(json.relationships, rels)
  const restored = AgentMemory.fromJSON(json)
  assert.deepEqual(restored.relationships, rels)
})

/* --------------------------- 全局提示词 --------------------------- */

test('buildAgentSystem：scenario + globalPrompt 注入全局设定段落', () => {
  const sys = buildAgentSystem({
    name: '甲',
    description: 'd',
    others: [{ id: 'B', name: '乙' }],
    topic: 't',
    scenario: '深夜的咖啡馆，窗外下着雨',
    globalPrompt: '对话基调为悬疑',
  })
  assert.ok(sys.includes('全局设定'), '应有全局设定段落')
  assert.ok(sys.includes('深夜的咖啡馆'), '应含 scenario')
  assert.ok(sys.includes('悬疑'), '应含 globalPrompt')
  // 全局设定应在主角设定之前（分层顺序）
  assert.ok(sys.indexOf('全局设定') < sys.indexOf('主角设定'))
})

test('buildAgentSystem：无 scenario/globalPrompt 时不出现全局设定段落', () => {
  const sys = buildAgentSystem({
    name: '甲',
    description: 'd',
    others: [{ id: 'B', name: '乙' }],
    topic: 't',
  })
  assert.ok(!sys.includes('全局设定'), '不应有全局设定段落')
})

test('buildApiMessages：scenario/globalPrompt 通过参数注入', () => {
  const mem = new AgentMemory(
    { id: 'A', name: '甲', description: 'd' },
    [{ id: 'B', name: '乙' }],
    't',
  )
  const msgs = mem.buildApiMessages(8, '场景X', '指令Y')
  assert.ok(msgs[0]!.content.includes('场景X'))
  assert.ok(msgs[0]!.content.includes('指令Y'))
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
