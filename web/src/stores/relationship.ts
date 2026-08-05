/**
 * 关系图 Store —— 全局智能体关系的单一数据源
 *
 * 独立于会话：关系基于模板 id 定义，持久化在 localStorage。
 * 新建对话时按 templateId → A/B/C 映射自动注入会话。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  loadRelationships,
  setRelationships,
  setPairRelationship,
  removePairRelationship,
  removeRelationshipsOf,
  loadNodePositions,
  saveNodePositions,
  removeNodePositionOf,
} from '@/services/relationships'

export const useRelationshipStore = defineStore('relationship', () => {
  /** 全局关系：Key "{fromTplId}->{toTplId}" */
  const relationships = ref<Record<string, string>>(loadRelationships())

  /** 节点位置：Key templateId */
  const nodePositions = ref<Record<string, { x: number; y: number }>>(loadNodePositions())

  /** 重新从 localStorage 拉取 */
  function refresh() {
    relationships.value = loadRelationships()
    nodePositions.value = loadNodePositions()
  }

  /** 整体覆盖（画布批量保存时） */
  function replaceAll(rels: Record<string, string>) {
    relationships.value = setRelationships(rels)
  }

  /** 设置/更新一对关系（两个方向） */
  function setPair(
    fromId: string,
    toId: string,
    fromToOther: string,
    otherToFrom: string,
  ) {
    relationships.value = setPairRelationship(fromId, toId, fromToOther, otherToFrom)
  }

  /** 删除一对关系（两个方向） */
  function removePair(fromId: string, toId: string) {
    relationships.value = removePairRelationship(fromId, toId)
  }

  /** 模板删除时清理：移除该模板的所有关系 + 节点位置 */
  function purgeTemplate(templateId: string) {
    relationships.value = removeRelationshipsOf(templateId)
    removeNodePositionOf(templateId)
    nodePositions.value = loadNodePositions()
  }

  /** 持久化节点位置（整体覆盖） */
  function persistPositions(positions: Record<string, { x: number; y: number }>) {
    saveNodePositions(positions)
    nodePositions.value = { ...positions }
  }

  /** 更新单个节点位置 */
  function updatePosition(templateId: string, pos: { x: number; y: number }) {
    const next = { ...nodePositions.value, [templateId]: pos }
    persistPositions(next)
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
