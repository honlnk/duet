/**
 * 全局关系图持久化层（localStorage）
 *
 * 管理智能体模板之间的非对称关系，独立于会话存在。
 * 关系在「设置 → 关系图」面板中预先定义，新建对话时按
 * templateId → A/B/C 映射自动注入到会话的 relationships 字段。
 *
 * Key 规范："{fromTemplateId}->{toTemplateId}"
 *   - fromId / toId 均为智能体模板 id（AgentTemplate.id）
 *   - 同一对双向关系对应两个 key（A→B 和 B→A）
 *
 * 节点位置（nodePositions）也在此持久化，key 同样为 templateId。
 */

const RELATIONSHIPS_KEY = 'duet:relationships:v1'
const NODE_POSITIONS_KEY = 'duet:node-positions:v1'

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/* --------------------------- 关系数据 --------------------------- */

/** 读取全部关系（Record<"{fromId}->{toId}", 描述>） */
export function loadRelationships(): Record<string, string> {
  try {
    return safeParse<Record<string, string>>(
      localStorage.getItem(RELATIONSHIPS_KEY),
      {},
    )
  } catch {
    return {}
  }
}

function saveRelationships(rels: Record<string, string>): void {
  try {
    localStorage.setItem(RELATIONSHIPS_KEY, JSON.stringify(rels))
  } catch {
    /* ignore */
  }
}

/**
 * 保存完整的关系对象（整体覆盖）。
 * 用于关系图画布批量更新。
 */
export function setRelationships(rels: Record<string, string>): Record<string, string> {
  const cleaned = cleanRelationships(rels)
  saveRelationships(cleaned)
  return cleaned
}

/**
 * 清理关系：移除指向自身的、值为 undefined 的条目。
 * （空字符串视为「已连线但未填写描述」，保留以便画布显示连线）
 */
function cleanRelationships(rels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(rels)) {
    const [from, to] = key.split('->')
    if (!from || !to || from === to) continue
    out[key] = typeof val === 'string' ? val : ''
  }
  return out
}

/**
 * 设置一对关系（两个方向）。传 null 值表示删除。
 */
export function setPairRelationship(
  fromId: string,
  toId: string,
  fromToOther: string | null,
  otherToFrom?: string | null,
): Record<string, string> {
  const rels = loadRelationships()
  const k1 = `${fromId}->${toId}`
  const k2 = `${toId}->${fromId}`
  if (fromToOther === null) {
    delete rels[k1]
  } else {
    rels[k1] = fromToOther
  }
  if (otherToFrom === null) {
    delete rels[k2]
  } else if (otherToFrom !== undefined) {
    rels[k2] = otherToFrom
  }
  saveRelationships(rels)
  return rels
}

/**
 * 删除一对关系（两个方向都移除）。
 */
export function removePairRelationship(
  fromId: string,
  toId: string,
): Record<string, string> {
  const rels = loadRelationships()
  delete rels[`${fromId}->${toId}`]
  delete rels[`${toId}->${fromId}`]
  saveRelationships(rels)
  return rels
}

/**
 * 删除某个模板参与的所有关系（模板删除时调用）。
 */
export function removeRelationshipsOf(templateId: string): Record<string, string> {
  const rels = loadRelationships()
  for (const key of Object.keys(rels)) {
    const [from, to] = key.split('->')
    if (from === templateId || to === templateId) {
      delete rels[key]
    }
  }
  saveRelationships(rels)
  return rels
}

/* --------------------------- 节点位置 --------------------------- */

/** 读取全部节点位置 */
export function loadNodePositions(): Record<string, { x: number; y: number }> {
  try {
    return safeParse<Record<string, { x: number; y: number }>>(
      localStorage.getItem(NODE_POSITIONS_KEY),
      {},
    )
  } catch {
    return {}
  }
}

/** 保存全部节点位置（整体覆盖） */
export function saveNodePositions(positions: Record<string, { x: number; y: number }>): void {
  try {
    localStorage.setItem(NODE_POSITIONS_KEY, JSON.stringify(positions))
  } catch {
    /* ignore */
  }
}

/** 删除某个模板的节点位置（模板删除时调用） */
export function removeNodePositionOf(templateId: string): void {
  const positions = loadNodePositions()
  delete positions[templateId]
  saveNodePositions(positions)
}

/* --------------------------- 会话注入 --------------------------- */

/**
 * 把全局关系（基于 templateId）翻译为会话关系（基于 A/B/C）。
 * 仅返回当前会话选中的智能体之间存在的关系。
 *
 * @param globalRels 全局关系图
 * @param idMap templateId → 会话内 AgentId 的映射（如 { 'a_xx': 'A', 'a_yy': 'B' }）
 */
export function translateRelationshipsForSession(
  globalRels: Record<string, string>,
  idMap: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(globalRels)) {
    const [fromTpl, toTpl] = key.split('->')
    const fromId = idMap[fromTpl!]
    const toId = idMap[toTpl!]
    if (!fromId || !toId) continue
    // 只保留有内容的（空字符串连线表示「未定义」不注入）
    if (val && val.trim()) {
      out[`${fromId}->${toId}`] = val
    }
  }
  return out
}
