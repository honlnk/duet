/**
 * 多角色单元测试（node:test）
 *
 * 纯逻辑验证：不依赖真实网络/Provider，覆盖
 *  - createSession 支持 2/3 角色与默认颜色分配
 *  - nextCharacterId 循环顺序（2/3 角色）
 *  - currentRound 按角色数计算
 *  - CharacterMemory 多对手视角（others 数组、buildApiMessages）
 *  - 结构化角色卡（description + personality）
 *  - 非对称关系图（relationships）
 *  - 全局设定（scenario）
 *
 * 运行：node --import tsx --test server/src/multi-character.test.ts
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

const { createSession, nextCharacterId, currentRound } = await import(
  './store/sessionStore.js'
)
const { CharacterMemory } = await import('./memory/context.js')
const { buildCharacterSystem, buildDirectorInjection } = await import('./ai/prompts.js')

/* --------------------------- createSession --------------------------- */

test('createSession：2 角色，默认颜色 蓝/粉', () => {
  const s = createSession({
    topic: '测试话题',
    characters: [
      { name: '猫派', description: '我喜欢猫' },
      { name: '狗派', description: '我喜欢狗' },
    ],
  })
  assert.equal(s.characters.length, 2)
  assert.equal(s.characters[0]!.id, 'A')
  assert.equal(s.characters[1]!.id, 'B')
  assert.equal(s.characters[0]!.color, 'blue')
  assert.equal(s.characters[1]!.color, 'pink')
  assert.equal(s.currentCharacterId, 'A')
  assert.equal(s.messageCount, 0)
  // memory.A/B 必有，C 不存在
  assert.ok(s.memory.A)
  assert.ok(s.memory.B)
  assert.equal(s.memory.C, undefined)
})

test('createSession：3 角色，默认颜色 蓝/粉/绿，memory.C 存在', () => {
  const s = createSession({
    topic: '三方讨论',
    characters: [
      { name: 'A', description: 'a' },
      { name: 'B', description: 'b' },
      { name: 'C', description: 'c' },
    ],
  })
  assert.equal(s.characters.length, 3)
  assert.equal(s.characters[2]!.id, 'C')
  assert.equal(s.characters[2]!.color, 'green')
  assert.ok(s.memory.C, '三角色 memory.C 应存在')
  // C 的 others 应包含 A 和 B
  const cOthers = s.memory.C.others.map((o) => o.id)
  assert.deepEqual([...cOthers].sort(), ['A', 'B'])
})

test('createSession：用户自定义颜色覆盖默认', () => {
  const s = createSession({
    topic: '自定义颜色',
    characters: [
      { name: 'X', color: 'purple' },
      { name: 'Y', color: 'teal' },
    ],
  })
  assert.equal(s.characters[0]!.color, 'purple')
  assert.equal(s.characters[1]!.color, 'teal')
})

test('createSession：5 角色（A-E），memory 全存在，默认色循环', () => {
  const s = createSession({
    topic: '五方讨论',
    characters: [
      { name: '甲' },
      { name: '乙' },
      { name: '丙' },
      { name: '丁' },
      { name: '戊' },
    ],
  })
  assert.equal(s.characters.length, 5)
  assert.equal(s.characters[3]!.id, 'D')
  assert.equal(s.characters[4]!.id, 'E')
  // 默认色循环：blue/pink/green/amber/purple
  assert.equal(s.characters[3]!.color, 'amber')
  assert.equal(s.characters[4]!.color, 'purple')
  // memory 应全部存在
  assert.ok(s.memory.D, 'memory.D 应存在')
  assert.ok(s.memory.E, 'memory.E 应存在')
  // E 的 others 应有 4 个（A/B/C/D）
  assert.equal(s.memory.E.others.length, 4)
})

test('createSession：自定义 hex 颜色（#ff5533）透传存储', () => {
  const s = createSession({
    topic: 'hex 颜色',
    characters: [
      { name: 'X', color: '#ff5533' },
      { name: 'Y', color: '#abc' },
    ],
  })
  assert.equal(s.characters[0]!.color, '#ff5533')
  assert.equal(s.characters[1]!.color, '#abc')
})

test('createSession：缺省 name 时按字母补默认名', () => {
  const s = createSession({
    topic: 't',
    characters: [{ name: '' }, { name: '' }],
  })
  assert.equal(s.characters[0]!.name, '角色 A')
  assert.equal(s.characters[1]!.name, '角色 B')
})

test('createSession：memory 视角隔离——A 的 others 不含自己', () => {
  const s = createSession({
    topic: '隔离测试',
    characters: [
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

/* --------------------------- nextCharacterId 循环 --------------------------- */

test('nextCharacterId：2 角色 A→B→A 循环', () => {
  const s = createSession({
    topic: 't',
    characters: [{ name: 'A' }, { name: 'B' }],
  })
  s.currentCharacterId = 'A'
  assert.equal(nextCharacterId(s), 'B')
  s.currentCharacterId = 'B'
  assert.equal(nextCharacterId(s), 'A')
})

test('nextCharacterId：3 角色 A→B→C→A 循环', () => {
  const s = createSession({
    topic: 't',
    characters: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  })
  s.currentCharacterId = 'A'
  assert.equal(nextCharacterId(s), 'B')
  s.currentCharacterId = 'B'
  assert.equal(nextCharacterId(s), 'C')
  s.currentCharacterId = 'C'
  assert.equal(nextCharacterId(s), 'A')
})

test('nextCharacterId：5 角色 A→B→C→D→E→A 循环', () => {
  const s = createSession({
    topic: 't',
    characters: [
      { name: 'A' },
      { name: 'B' },
      { name: 'C' },
      { name: 'D' },
      { name: 'E' },
    ],
  })
  s.currentCharacterId = 'C'
  assert.equal(nextCharacterId(s), 'D')
  s.currentCharacterId = 'E'
  assert.equal(nextCharacterId(s), 'A')
})

/* --------------------------- currentRound --------------------------- */

test('currentRound：2 角色时 2 条/轮', () => {
  const s = createSession({
    topic: 't',
    characters: [{ name: 'A' }, { name: 'B' }],
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

test('currentRound：3 角色时 3 条/轮', () => {
  const s = createSession({
    topic: 't',
    characters: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  })
  s.messageCount = 2
  assert.equal(currentRound(s), 0)
  s.messageCount = 3
  assert.equal(currentRound(s), 1)
  s.messageCount = 6
  assert.equal(currentRound(s), 2)
})

/* --------------------------- CharacterMemory --------------------------- */

test('CharacterMemory：多对手 buildApiMessages 含 system + 所有对手名', () => {
  const me = { id: 'A' as const, name: '甲', description: '我是甲' }
  const others = [
    { id: 'B' as const, name: '乙', description: 'b' },
    { id: 'C' as const, name: '丙', description: 'c' },
  ]
  const mem = new CharacterMemory(me, others, '话题')
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

test('CharacterMemory：toJSON/fromJSON 往返保持 others', () => {
  const me = { id: 'A' as const, name: '甲' }
  const others = [
    { id: 'B' as const, name: '乙' },
    { id: 'C' as const, name: '丙' },
  ]
  const mem = new CharacterMemory(me, others, 't')
  mem.pushSelf('hi')
  mem.summary = '旧摘要'

  const json = mem.toJSON()
  assert.equal(json.others.length, 2)

  const restored = CharacterMemory.fromJSON(json)
  assert.equal(restored.others.length, 2)
  assert.equal(restored.summary, '旧摘要')
  assert.equal(restored.messages.length, 1)
})

test('CharacterMemory：trimToRecent 裁剪到最近 N 条', () => {
  const mem = new CharacterMemory(
    { id: 'A', name: '甲' },
    [{ id: 'B', name: '乙' }],
    't',
  )
  for (let i = 0; i < 10; i++) mem.pushSelf(`第${i}句`)
  mem.trimToRecent(3)
  assert.equal(mem.messages.length, 3)
  assert.equal(mem.messages[0]!.content, '第7句')
})

/* --------------------------- buildCharacterSystem --------------------------- */

test('buildCharacterSystem：单对手时列出参与者', () => {
  const sys = buildCharacterSystem({
    name: '甲',
    description: 'd',
    others: [{ id: 'B', name: '乙' }],
    topic: '话题',
  })
  assert.ok(sys.includes('乙'))
})

test('buildCharacterSystem：多对手时列出所有参与者', () => {
  const sys = buildCharacterSystem({
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
})

/* --------------------------- 结构化角色卡 --------------------------- */

test('createSession：description + personality 透传存储', () => {
  const s = createSession({
    topic: 't',
    characters: [
      { name: '甲', description: '阳光男孩', personality: '开朗' },
      { name: '乙', description: '温柔女孩', personality: '善良' },
    ],
  })
  assert.equal(s.characters[0]!.description, '阳光男孩')
  assert.equal(s.characters[0]!.personality, '开朗')
  assert.equal(s.characters[1]!.description, '温柔女孩')
  assert.equal(s.characters[1]!.personality, '善良')
  // memory 中也透传
  assert.equal(s.memory.A.character.description, '阳光男孩')
  assert.equal(s.memory.A.character.personality, '开朗')
  assert.equal(s.memory.B.others[0]!.description, '阳光男孩')
})

test('buildCharacterSystem：主角 description + personality 注入', () => {
  const sys = buildCharacterSystem({
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

test('buildCharacterSystem：他人 description 注入到在场角色', () => {
  const sys = buildCharacterSystem({
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
    characters: [
      { name: '小张', description: 'd' },
      { name: '小美', description: 'd' },
    ],
    relationships: rels,
  })
  assert.deepEqual(s.relationships, rels)
  assert.deepEqual(s.memory.A.relationships, rels)
  assert.deepEqual(s.memory.B.relationships, rels)
})

test('CharacterMemory：extractMyRelationships 注入到 system prompt（非对称）', () => {
  const rels = {
    'A->B': '小美是我的同桌，暗恋我',
    'B->A': '小张是我的Crush',
  }
  const memA = new CharacterMemory(
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

  const memB = new CharacterMemory(
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

test('CharacterMemory：toJSON/fromJSON 往返保持 relationships', () => {
  const rels = { 'A->B': '关系A' }
  const mem = new CharacterMemory(
    { id: 'A', name: '甲' },
    [{ id: 'B', name: '乙' }],
    't',
    rels,
  )
  const json = mem.toJSON()
  assert.deepEqual(json.relationships, rels)
  const restored = CharacterMemory.fromJSON(json)
  assert.deepEqual(restored.relationships, rels)
})

/* --------------------------- 全局设定 --------------------------- */

test('buildCharacterSystem：scenario 注入全局设定段落', () => {
  const sys = buildCharacterSystem({
    name: '甲',
    description: 'd',
    others: [{ id: 'B', name: '乙' }],
    topic: '测试话题',
    scenario: '深夜的咖啡馆，窗外下着雨',
  })
  assert.ok(sys.includes('全局设定'), '应有全局设定段落')
  assert.ok(sys.includes('深夜的咖啡馆'), '应含 scenario')
  assert.ok(sys.includes('测试话题'), '应含 topic')
  // 话题应在场景设定之前（话题恒在全局设定最前）
  assert.ok(sys.indexOf('测试话题') < sys.indexOf('深夜的咖啡馆'))
  // 全局设定应在主角设定之前（分层顺序）
  assert.ok(sys.indexOf('全局设定') < sys.indexOf('主角设定'))
})

test('buildCharacterSystem：无 scenario 时全局设定仍含话题', () => {
  const sys = buildCharacterSystem({
    name: '甲',
    description: 'd',
    others: [{ id: 'B', name: '乙' }],
    topic: '测试话题',
  })
  assert.ok(sys.includes('全局设定'), '应有全局设定段落（话题恒在）')
  assert.ok(sys.includes('测试话题'), '应含 topic')
  assert.ok(!sys.includes('场景设定'), '无 scenario 时不应有 [场景设定] 标签')
})

test('buildApiMessages：scenario 通过参数注入', () => {
  const mem = new CharacterMemory(
    { id: 'A', name: '甲', description: 'd' },
    [{ id: 'B', name: '乙' }],
    't',
  )
  const msgs = mem.buildApiMessages(8, '场景X')
  assert.ok(msgs[0]!.content.includes('场景X'))
})

/* --------------------------- 导演指令 --------------------------- */

test('buildDirectorInjection：活跃指令合并为一个注入块', () => {
  const directors = [
    { id: '1', content: '让话题转向哲学', addedAt: 0, addedRound: 0, durationRounds: 5 },
    { id: '2', content: '加入意外事件', addedAt: 0, addedRound: 0, durationRounds: 0 },
  ]
  const injection = buildDirectorInjection(directors, 3)
  assert.ok(injection, '应有注入文本')
  assert.ok(injection!.startsWith('「导演提示'), '应以「导演提示」标记开头')
  assert.ok(injection!.endsWith('」'), '应以」结尾')
  assert.ok(injection!.includes('哲学'), '应含第一条指令')
  assert.ok(injection!.includes('意外事件'), '应含第二条指令')
})

test('buildDirectorInjection：过期指令被过滤', () => {
  const directors = [
    { id: '1', content: '过期指令', addedAt: 0, addedRound: 0, durationRounds: 3 },
    { id: '2', content: '活跃指令', addedAt: 0, addedRound: 2, durationRounds: 5 },
  ]
  // round=5：第一条 addedRound=0 durationRounds=3 → 5-0=5 >= 3 过期
  //          第二条 addedRound=2 durationRounds=5 → 5-2=3 < 5 活跃
  const injection = buildDirectorInjection(directors, 5)
  assert.ok(injection, '应有注入文本（含活跃指令）')
  assert.ok(!injection!.includes('过期指令'), '过期指令应被过滤')
  assert.ok(injection!.includes('活跃指令'), '活跃指令应保留')
})

test('buildDirectorInjection：永久指令（durationRounds=0）永不过期', () => {
  const directors = [
    { id: '1', content: '永久指令', addedAt: 0, addedRound: 0, durationRounds: 0 },
  ]
  const injection = buildDirectorInjection(directors, 999)
  assert.ok(injection, '永久指令应注入')
  assert.ok(injection!.includes('永久指令'))
})

test('buildDirectorInjection：无活跃指令返回 null', () => {
  const directors: { id: string; content: string; addedAt: number; addedRound: number; durationRounds: number }[] = []
  assert.equal(buildDirectorInjection(directors, 0), null)
  // 全部过期
  const expired = [
    { id: '1', content: '过期', addedAt: 0, addedRound: 0, durationRounds: 2 },
  ]
  assert.equal(buildDirectorInjection(expired, 10), null)
})

test('buildApiMessages：导演指令临时拼到最后一条消息尾部，不污染记忆', () => {
  const directors = [
    { id: '1', content: '让甲表达愤怒', addedAt: 0, addedRound: 0, durationRounds: 0 },
  ]
  const mem = new CharacterMemory(
    { id: 'A', name: '甲', description: 'd' },
    [{ id: 'B', name: '乙' }],
    't',
  )
  mem.pushOther('[乙]: 我说了一句')
  const msgs = mem.buildApiMessages(8, undefined, directors, 1)
  // system + user = 2，不新增 system 消息，注入拼在最后一条尾部
  assert.equal(msgs.length, 2)
  assert.equal(msgs[1]!.role, 'user')
  assert.ok(msgs[1]!.content.includes('[乙]: 我说了一句'), '原内容保留')
  assert.ok(msgs[1]!.content.endsWith('「导演提示：让甲表达愤怒」'), '尾部应拼接导演提示块')
  // 注入仅存在于 payload，不得写回真实记忆
  assert.ok(!mem.messages[0]!.content.includes('导演提示'), '存储记忆不应含导演提示')
})

test('buildApiMessages：摘要 + 导演指令共存时的注入位置', () => {
  const directors = [
    { id: '1', content: '指令A', addedAt: 0, addedRound: 0, durationRounds: 0 },
  ]
  const mem = new CharacterMemory(
    { id: 'A', name: '甲' },
    [{ id: 'B', name: '乙' }],
    't',
  )
  mem.summary = '这是摘要'
  mem.pushSelf('发言')
  const msgs = mem.buildApiMessages(8, undefined, directors, 1)
  // system(主) + system(摘要) + assistant(尾部拼导演提示) = 3
  assert.equal(msgs.length, 3)
  assert.ok(msgs[1]!.content.includes('摘要'), '第二条应为摘要')
  assert.ok(msgs[2]!.content.includes('发言'), '最后一条消息原内容保留')
  assert.ok(msgs[2]!.content.endsWith('「导演提示：指令A」'), '导演提示应拼在最后一条消息尾部')
})

test('buildApiMessages：无活跃导演指令时最后一条消息保持原样', () => {
  const directors = [
    { id: '1', content: '过期指令', addedAt: 0, addedRound: 0, durationRounds: 2 },
  ]
  const mem = new CharacterMemory(
    { id: 'A', name: '甲' },
    [{ id: 'B', name: '乙' }],
    't',
  )
  mem.pushOther('[乙]: 原话')
  const msgs = mem.buildApiMessages(8, undefined, directors, 10)
  assert.equal(msgs.length, 2)
  assert.equal(msgs[1]!.content, '[乙]: 原话', '无活跃指令时不得拼接')
})

test('buildCharacterSystem：system 规则中定义「导演提示」标记契约', () => {
  const sys = buildCharacterSystem({
    name: '甲',
    others: [{ id: 'B', name: '乙' }],
    topic: 't',
  })
  assert.ok(sys.includes('「导演提示'), 'system 应包含导演提示标记的执行规则')
  assert.ok(sys.includes('优先级最高'), '应声明最高优先级')
  assert.ok(sys.includes('不要在发言中提及'), '应禁止在台前复述指令')
})

test('createSession：默认初始化 directors 空数组 + pacing 默认值', () => {
  const s = createSession({
    topic: 't',
    characters: [{ name: 'A' }, { name: 'B' }],
  })
  assert.deepEqual(s.directors, [])
  assert.equal(s.config.pacingEnabled, true)
  assert.equal(s.config.pacingBufferRounds, 2)
})

test('createSession：可通过 config 覆盖 pacing 默认值', () => {
  const s = createSession({
    topic: 't',
    characters: [{ name: 'A' }, { name: 'B' }],
    config: { pacingEnabled: true, pacingBufferRounds: 5 },
  })
  assert.equal(s.config.pacingEnabled, true)
  assert.equal(s.config.pacingBufferRounds, 5)
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
