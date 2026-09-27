/**
 * libraryStore 单元测试：模板 CRUD / 关系读写 / 迁移导入幂等
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  _resetForTest,
  deleteCharacterTemplate,
  deleteRelationship,
  deleteTopicTemplate,
  deleteWorldviewTemplate,
  getRelationships,
  importLibrary,
  libraryIsEmpty,
  listCharacterTemplates,
  listTopicTemplates,
  listWorldviewTemplates,
  setRelationship,
  setRelationships,
  upsertCharacterTemplate,
  upsertTopicTemplate,
  upsertWorldviewTemplate,
} from './store/libraryStore.js'

/** 每个测试用独立的临时文件，避免相互污染 */
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-library-test-'))
  _resetForTest(path.join(dir, 'library.json'))
})

/* --------------------------- 角色模板 --------------------------- */

test('角色模板：新建 → 列表可见', () => {
  const created = upsertCharacterTemplate({
    name: '小张',
    description: '高中生，爱打篮球',
    personality: '热血',
  })
  assert.ok(created.id.startsWith('ct_'))
  assert.equal(created.name, '小张')
  assert.equal(created.description, '高中生，爱打篮球')

  const list = listCharacterTemplates()
  assert.equal(list.length, 1)
  assert.equal(list[0]!.name, '小张')
})

test('角色模板：按 id 更新', () => {
  const created = upsertCharacterTemplate({ name: '小美', personality: '文静' })
  const updated = upsertCharacterTemplate({ id: created.id, name: '小美', personality: '外冷内热' })
  assert.equal(updated.id, created.id)
  assert.equal(updated.personality, '外冷内热')
  assert.equal(listCharacterTemplates().length, 1)
})

test('角色模板：更新不存在的 id 抛错', () => {
  assert.throws(() => upsertCharacterTemplate({ id: 'ct_none', name: 'x' }), /不存在/)
})

test('角色模板：name 为空抛错', () => {
  assert.throws(() => upsertCharacterTemplate({ name: '  ' }))
})

test('角色模板：删除 + 级联清理关系与节点坐标', () => {
  const a = upsertCharacterTemplate({ name: 'A' })
  const b = upsertCharacterTemplate({ name: 'B' })
  setRelationship(a.id, b.id, 'A 视角的关系')
  setRelationships(
    { [`${a.id}->${b.id}`]: 'A 视角的关系' },
    { [a.id]: { x: 1, y: 2 } },
  )

  assert.equal(deleteCharacterTemplate(a.id), true)
  assert.equal(deleteCharacterTemplate(a.id), false) // 二次删除 404
  const rels = getRelationships()
  assert.equal(Object.keys(rels.relationships).length, 0, '引用被删模板的关系应级联清理')
  assert.equal(Object.keys(rels.nodePositions).length, 0, '被删模板的节点坐标应级联清理')
})

/* --------------------------- 话题 / 世界观模板 --------------------------- */

test('话题模板：CRUD 往返', () => {
  const created = upsertTopicTemplate({ content: '讨论 AI 立法' })
  assert.ok(created.id.startsWith('tt_'))
  upsertTopicTemplate({ id: created.id, content: '讨论 AI 立法（修订）' })
  assert.equal(listTopicTemplates()[0]!.content, '讨论 AI 立法（修订）')
  assert.equal(deleteTopicTemplate(created.id), true)
  assert.equal(listTopicTemplates().length, 0)
})

test('世界观模板：CRUD 往返', () => {
  const created = upsertWorldviewTemplate({ name: '校园日常', scenario: '高二暑假前' })
  assert.ok(created.id.startsWith('wt_'))
  upsertWorldviewTemplate({ id: created.id, name: '校园日常', scenario: '高三开学' })
  assert.equal(listWorldviewTemplates()[0]!.scenario, '高三开学')
  assert.equal(deleteWorldviewTemplate(created.id), true)
  assert.equal(listWorldviewTemplates().length, 0)
})

/* --------------------------- 关系 --------------------------- */

test('关系：单条设置 / 删除 / 覆盖保存', () => {
  const a = upsertCharacterTemplate({ name: 'A' })
  const b = upsertCharacterTemplate({ name: 'B' })

  setRelationship(a.id, b.id, '同桌')
  assert.equal(getRelationships().relationships[`${a.id}->${b.id}`], '同桌')

  setRelationship(a.id, b.id, '同桌兼竞争对手')
  assert.equal(getRelationships().relationships[`${a.id}->${b.id}`], '同桌兼竞争对手')

  assert.equal(deleteRelationship(a.id, b.id), true)
  assert.equal(deleteRelationship(a.id, b.id), false)

  // 整体覆盖：清掉关系但保留节点坐标
  setRelationships({}, { [a.id]: { x: 10, y: 20 } })
  const rels = getRelationships()
  assert.equal(Object.keys(rels.relationships).length, 0)
  assert.deepEqual(rels.nodePositions[a.id], { x: 10, y: 20 })
})

test('关系：拒绝指向自己', () => {
  const a = upsertCharacterTemplate({ name: 'A' })
  assert.throws(() => setRelationship(a.id, a.id, '自恋'))
})

/* --------------------------- 迁移导入 --------------------------- */

test('导入：保 id upsert，重复导入幂等', () => {
  const r1 = importLibrary({
    characterTemplates: [
      { id: 'ct_old1', name: '小张', description: '旧描述', createdAt: 111 },
      { id: 'ct_old2', name: '小美' },
    ],
    topicTemplates: [{ id: 'tt_old1', content: '旧话题' }],
    worldviewTemplates: [{ id: 'wt_old1', name: '校园' }],
    relationships: { 'ct_old1->ct_old2': '同学' },
    nodePositions: { ct_old1: { x: 1, y: 2 } },
  })
  assert.deepEqual(r1, { characters: 2, topics: 1, worldviews: 1, relationships: 1 })
  assert.equal(libraryIsEmpty(), false)

  // id 原样保留
  const list = listCharacterTemplates()
  assert.deepEqual(list.map((t) => t.id).sort(), ['ct_old1', 'ct_old2'])
  assert.equal(list[0]!.createdAt, 111)

  // 同数据再导一次：不产生重复
  const r2 = importLibrary({
    characterTemplates: [
      { id: 'ct_old1', name: '小张', description: '新描述', createdAt: 111 },
      { id: 'ct_old2', name: '小美' },
    ],
    topicTemplates: [{ id: 'tt_old1', content: '旧话题' }],
    worldviewTemplates: [{ id: 'wt_old1', name: '校园' }],
    relationships: { 'ct_old1->ct_old2': '同学' },
  })
  assert.equal(r2.characters, 2)
  assert.equal(listCharacterTemplates().length, 2, '幂等：不重复')
  assert.equal(listCharacterTemplates().find((t) => t.id === 'ct_old1')!.description, '新描述', '同 id 更新')
})

test('导入：脏数据跳过（无 id / 空名）', () => {
  importLibrary({
    characterTemplates: [{ name: '无 id 被跳过' }, { id: 'ct_x', name: '  ' }],
    relationships: { 'a->a': '自指向被清掉', '->b': '缺端被清掉' },
  })
  assert.equal(listCharacterTemplates().length, 0)
  assert.equal(Object.keys(getRelationships().relationships).length, 0)
})

test('空库判定', () => {
  assert.equal(libraryIsEmpty(), true)
  upsertTopicTemplate({ content: 'x' })
  assert.equal(libraryIsEmpty(), false)
})

test('落盘恢复：进程重启后数据仍在', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-library-reload-'))
  const file = path.join(dir, 'library.json')
  _resetForTest(file)
  const created = upsertCharacterTemplate({ name: '持久化验证' })

  // 模拟重启：清空内存态，重新从同一文件加载
  _resetForTest(file)
  const list = listCharacterTemplates()
  assert.equal(list.length, 1)
  assert.equal(list[0]!.name, '持久化验证')
  assert.equal(list[0]!.id, created.id)
})

/* --------------------------- REST 路由（fastify.inject） --------------------------- */

test('REST 路由：模板 CRUD 往返 + 校验 + 404', async () => {
  const Fastify = (await import('fastify')).default
  const libraryRoutes = (await import('./routes/library.js')).default
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-library-api-'))
  _resetForTest(path.join(dir, 'library.json'))

  const app = Fastify()
  await app.register(libraryRoutes)

  // 角色模板：创建 → 列表 → 更新 → 删除
  const created = await app.inject({ method: 'POST', url: '/api/templates/characters', payload: { name: '小张', personality: '热血' } })
  assert.equal(created.statusCode, 200)
  const ct = created.json() as { id: string; name: string }
  assert.equal(ct.name, '小张')

  const listed = await app.inject({ method: 'GET', url: '/api/templates/characters' })
  assert.equal((listed.json() as unknown[]).length, 1)

  const updated = await app.inject({ method: 'PUT', url: `/api/templates/characters/${ct.id}`, payload: { name: '小张', personality: '冷静' } })
  assert.equal(updated.statusCode, 200)
  assert.equal((updated.json() as { personality: string }).personality, '冷静')

  const badUpdate = await app.inject({ method: 'PUT', url: '/api/templates/characters/ct_none', payload: { name: 'x' } })
  assert.equal(badUpdate.statusCode, 404)

  const badCreate = await app.inject({ method: 'POST', url: '/api/templates/characters', payload: { description: '缺 name' } })
  assert.equal(badCreate.statusCode, 400)

  const deleted = await app.inject({ method: 'DELETE', url: `/api/templates/characters/${ct.id}` })
  assert.equal(deleted.statusCode, 200)
  const deletedAgain = await app.inject({ method: 'DELETE', url: `/api/templates/characters/${ct.id}` })
  assert.equal(deletedAgain.statusCode, 404)

  // 话题 / 世界观同构（抽样验证）
  const tt = await app.inject({ method: 'POST', url: '/api/templates/topics', payload: { content: '话题' } })
  assert.equal(tt.statusCode, 200)
  const wt = await app.inject({ method: 'POST', url: '/api/templates/worldviews', payload: { name: '校园' } })
  assert.equal(wt.statusCode, 200)

  // 关系：整体覆盖 + 读回
  const relPut = await app.inject({
    method: 'PUT',
    url: '/api/relationships',
    payload: { relationships: { 'a->b': '同学' }, nodePositions: { a: { x: 1, y: 2 } } },
  })
  assert.equal(relPut.statusCode, 200)
  const relGet = (await app.inject({ method: 'GET', url: '/api/relationships' })).json() as {
    relationships: Record<string, string>
    nodePositions: Record<string, { x: number; y: number }>
  }
  assert.equal(relGet.relationships['a->b'], '同学')
  assert.deepEqual(relGet.nodePositions.a, { x: 1, y: 2 })

  // 迁移导入 + 状态
  const imp = await app.inject({
    method: 'POST',
    url: '/api/library/import',
    payload: { characterTemplates: [{ id: 'ct_m1', name: '迁移角色' }] },
  })
  assert.equal(imp.statusCode, 200)
  assert.equal((imp.json() as { characters: number }).characters, 1)
  const status = (await app.inject({ method: 'GET', url: '/api/library/status' })).json() as { empty: boolean }
  assert.equal(status.empty, false)

  await app.close()
})
