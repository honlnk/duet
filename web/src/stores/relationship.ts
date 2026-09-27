/**
 * 关系图 Store —— 全局角色关系的单一数据源
 *
 * 独立于会话：关系基于模板 id 定义，持久化在服务端资产库。
 * 新建对话时按 templateId → A/B/C 映射自动注入会话。
 * v2：数据源从 localStorage 换为服务端 REST；变更方法内部走服务端，
 * 本地 ref 同步更新保持画布即时反馈，失败时刷新兜底。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  loadRelationships,
  loadNodePositions,
  saveNodePositions,
  setRelationships,
  setPairRelationship,
  removePairRelationship,
} from '@/services/relationships'

export const useRelationshipStore = defineStore('relationship', () => {
  /** 全局关系：Key "{fromTplId}->{toTplId}" */
  const relationships = ref<Record<string, string>>({})

  /** 节点位置：Key templateId */
  const nodePositions = ref<Record<string, { x: number; y: number }>>({})

  /** 重新从服务端拉取（外部修改后同步，如 Agent 助手改动资产） */
  async function refresh(): Promise<void> {
    const [rels, pos] = await Promise.all([loadRelationships(), loadNodePositions()])
    relationships.value = rels
    nodePositions.value = pos
  }

  /** 整体覆盖（画布批量保存时） */
  async function replaceAll(rels: Record<string, string>): Promise<void> {
    relationships.value = { ...rels }
    try {
      relationships.value = await setRelationships(rels)
    } catch (e) {
      console.warn('[relationship] 保存关系失败', e)
      await refresh()
    }
  }

  /** 设置/更新一对关系（两个方向） */
  async function setPair(
    fromId: string,
    toId: string,
    fromToOther: string,
    otherToFrom: string,
  ): Promise<void> {
    try {
      relationships.value = await setPairRelationship(fromId, toId, fromToOther, otherToFrom)
    } catch (e) {
      console.warn('[relationship] 保存关系失败', e)
      await refresh()
    }
  }

  /** 删除一对关系（两个方向） */
  async function removePair(fromId: string, toId: string): Promise<void> {
    try {
      relationships.value = await removePairRelationship(fromId, toId)
    } catch (e) {
      console.warn('[relationship] 删除关系失败', e)
      await refresh()
    }
  }

  /**
   * 模板删除时清理：服务端删除角色模板已级联清理其关系与坐标，
   * 这里只做本地即时清理 + 后台刷新对齐。
   */
  async function purgeTemplate(templateId: string): Promise<void> {
    const rels = { ...relationships.value }
    for (const key of Object.keys(rels)) {
      const [from, to] = key.split('->')
      if (from === templateId || to === templateId) delete rels[key]
    }
    relationships.value = rels
    delete nodePositions.value[templateId]
    await refresh()
  }

  /** 持久化节点位置（整体覆盖，防抖由调用方控制） */
  async function persistPositions(positions: Record<string, { x: number; y: number }>): Promise<void> {
    nodePositions.value = { ...positions }
    try {
      await saveNodePositions(positions)
    } catch (e) {
      console.warn('[relationship] 保存节点位置失败', e)
    }
  }

  /** 更新单个节点位置 */
  async function updatePosition(templateId: string, pos: { x: number; y: number }): Promise<void> {
    await persistPositions({ ...nodePositions.value, [templateId]: pos })
  }

  return {
    relationships,
    nodePositions,
    refresh,
    replaceAll,
    setPair,
    removePair,
    purgeTemplate,
    persistPositions,
    updatePosition,
  }
})
