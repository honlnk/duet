/**
 * 资产库一次性迁移：浏览器 localStorage → 服务端 data/library.json
 *
 * 触发条件（应用启动时调用，幂等）：
 *  1. 未写过迁移标记 key `duet:library-migrated:v1`
 *  2. localStorage 里存在任一旧资产数据
 *  3. 服务端资产库为空（避免第二台浏览器覆盖服务端已有数据）
 *
 * 导入按 id upsert（服务端幂等），成功后写迁移标记；
 * 旧 localStorage key 保留不删（作备份），此后不再有任何写入路径。
 * 半途失败不写标记，下次启动自动重试。
 */
import { request } from './api'
import {
  readLegacyNodePositions,
  readLegacyRelationships,
} from './relationships'

/** 迁移完成标记（写入后永不再迁移） */
const MIGRATED_KEY = 'duet:library-migrated:v1'

/** 旧 localStorage key（与 templates.ts 的 localStorage 时期一致） */
const LEGACY_CHARACTER_TPL_KEY = 'duet:character-templates:v1'
const LEGACY_AGENT_TPL_KEY = 'duet:agent-templates:v1'
const LEGACY_TOPIC_TPL_KEY = 'duet:topic-templates:v1'
const LEGACY_WORLDVIEW_TPL_KEY = 'duet:worldview-templates:v1'

interface LegacyTemplate {
  id: string
  name?: string
  description?: string
  personality?: string
  content?: string
  scenario?: string
  createdAt?: number
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function readLegacyList(key: string): LegacyTemplate[] {
  return safeParse<LegacyTemplate[]>(localStorage.getItem(key), [])
}

/**
 * 执行一次性迁移。返回是否有数据被导入。
 * 任何一步失败都向上抛（App 启动处 catch 后静默跳过，下次启动重试）。
 */
export async function migrateLocalStorageLibrary(): Promise<boolean> {
  if (localStorage.getItem(MIGRATED_KEY)) return false

  // 角色模板：新键优先，缺失时兼容更早的智能体时期旧键
  let characters = readLegacyList(LEGACY_CHARACTER_TPL_KEY)
  if (characters.length === 0) {
    characters = readLegacyList(LEGACY_AGENT_TPL_KEY)
  }
  const topics = readLegacyList(LEGACY_TOPIC_TPL_KEY)
  const worldviews = readLegacyList(LEGACY_WORLDVIEW_TPL_KEY)
  const relationships = readLegacyRelationships()
  const nodePositions = readLegacyNodePositions()

  const hasLegacyData =
    characters.length > 0 ||
    topics.length > 0 ||
    worldviews.length > 0 ||
    Object.keys(relationships).length > 0 ||
    Object.keys(nodePositions).length > 0

  if (!hasLegacyData) {
    localStorage.setItem(MIGRATED_KEY, '1')
    return false
  }

  // 服务端已有数据（如另一台浏览器先迁移过 / Agent 已建过资产）→ 不覆盖，只标记
  const status = await request<{ empty: boolean }>('/api/library/status')
  if (!status.empty) {
    localStorage.setItem(MIGRATED_KEY, '1')
    return false
  }

  await request('/api/library/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      characterTemplates: characters,
      topicTemplates: topics,
      worldviewTemplates: worldviews,
      relationships,
      nodePositions,
    }),
  })

  localStorage.setItem(MIGRATED_KEY, '1')
  return true
}
