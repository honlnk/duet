<script setup lang="ts">
/**
 * 关系图画布（全局，设置页内嵌）
 *
 * 功能：
 *  - 渲染所有智能体模板为节点（自定义卡片：name + description 摘要）
 *  - 拖拽节点定位（持久化到 localStorage，key = templateId）
 *  - 从节点 handle 拖拽创建连线 → 建立双向关系
 *  - 点击连线打开 RelationshipEdgeDialog 编辑两个视角的关系描述
 *  - 右上角全屏按钮：铺满整个浏览器窗口
 *  - 边无箭头（双向关系语义）
 *
 * 关系数据基于 templateId，存于全局 relationshipStore，
 * 新建会话时按 templateId → A/B/C 映射自动注入。
 */
import { computed, ref, watch } from 'vue'
import { VueFlow, Handle, Position, useVueFlow } from '@vue-flow/core'
import type {
  Connection,
  DefaultEdgeOptions,
  Edge,
  EdgeMouseEvent,
  Node,
  NodeDragEvent,
} from '@vue-flow/core'
import { storeToRefs } from 'pinia'
import { useTemplateStore } from '@/stores/template'
import { useRelationshipStore } from '@/stores/relationship'
import {
  bgColor,
  textColor,
  resolveColor,
  colorHex,
} from '@/utils/agentColor'
import RelationshipEdgeDialog from './RelationshipEdgeDialog.vue'
import type { AgentColor, AgentId } from '@/types/api'

/* --------------------------- Stores --------------------------- */

const templateStore = useTemplateStore()
const { agents: agentTemplates } = storeToRefs(templateStore)
const relationshipStore = useRelationshipStore()
const { relationships, nodePositions } = storeToRefs(relationshipStore)

/* --------------------------- 适配 RelationshipEdgeDialog 的 Agent 类型 --------------------------- */

/** RelationshipEdgeDialog 接受 Agent 接口（含 id: AgentId），这里把 template 映射为兼容形态 */
interface TemplateNodeAgent {
  id: AgentId
  name: string
  description?: string
  color?: AgentColor
}

/* --------------------------- Vue Flow 状态 --------------------------- */

const nodes = ref<Node<AgentNodeData>[]>([])
const edges = ref<Edge[]>([])

/** 默认节点位置：圆形布局 */
function defaultPositionFor(
  index: number,
  total: number,
): { x: number; y: number } {
  if (total <= 1) return { x: 400, y: 300 }
  const radius = Math.max(200, total * 50)
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2
  return {
    x: 400 + Math.cos(angle) * radius,
    y: 320 + Math.sin(angle) * radius,
  }
}

interface AgentNodeData {
  name: string
  description: string
  personality: string
  color: string
  colorIndex: number
}

const defaultEdgeOptions: DefaultEdgeOptions = {
  type: 'default',
  style: { strokeWidth: 2, stroke: '#94a3b8' },
}

/* --------------------------- 渲染：从 store 重建 nodes / edges --------------------------- */

function rebuildGraph() {
  const list = agentTemplates.value
  if (list.length === 0) {
    nodes.value = []
    edges.value = []
    return
  }
  // 节点
  const nodeList: Node<AgentNodeData>[] = []
  list.forEach((t, i) => {
    const pos =
      nodePositions.value[t.id] ?? defaultPositionFor(i, list.length)
    const node: Node<AgentNodeData> = {
      id: t.id,
      type: 'agent',
      position: { ...pos },
      data: {
        name: t.name,
        description: t.description || '',
        personality: t.personality || '',
        color: resolveColor(undefined, i),
        colorIndex: i,
      },
      draggable: true,
      connectable: true,
    }
    nodeList.push(node)
  })
  nodes.value = nodeList

  // 边：从 relationships 提取（去重：A-B / B-A 视为同一条连线）
  const rels = relationships.value
  const seen = new Set<string>()
  const edgeList: Edge[] = []
  for (const key of Object.keys(rels)) {
    const [from, to] = key.split('->')
    if (!from || !to) continue
    const pairKey = [from, to].sort().join('-')
    if (seen.has(pairKey)) continue
    seen.add(pairKey)
    edgeList.push({
      id: `e-${pairKey}`,
      source: from,
      target: to,
      style: { strokeWidth: 2, stroke: '#94a3b8' },
    })
  }
  edges.value = edgeList
}

/* --------------------------- Vue Flow composable --------------------------- */

const { onConnect, onEdgeClick, onNodeDragStop, addEdges } =
  useVueFlow()
const vueFlow = useVueFlow()

onConnect((connection: Connection) => {
  const { source, target } = connection
  if (!source || !target) return
  // 防自环
  if (source === target) return
  // 防重复
  const exists = edges.value.some(
    (e) =>
      (e.source === source && e.target === target) ||
      (e.source === target && e.target === source),
  )
  if (exists) return

  const pairKey = [source, target].sort().join('-')
  addEdges({
    id: `e-${pairKey}`,
    source,
    target,
    style: { strokeWidth: 2, stroke: '#94a3b8' },
  })

  // 初始化两条空关系（连线已建立，描述待填）
  const newRels = { ...relationships.value }
  if (newRels[`${source}->${target}`] == null)
    newRels[`${source}->${target}`] = ''
  if (newRels[`${target}->${source}`] == null)
    newRels[`${target}->${source}`] = ''
  relationshipStore.replaceAll(newRels)

  // 创建后自动打开编辑弹窗
  openEdgeDialog(source, target)
})

onEdgeClick((e: EdgeMouseEvent) => {
  const { source, target } = e.edge
  if (source && target) openEdgeDialog(source, target)
})

onNodeDragStop((drag: NodeDragEvent) => {
  const positions: Record<string, { x: number; y: number }> = {
    ...nodePositions.value,
  }
  for (const n of drag.nodes) {
    positions[n.id] = { x: n.position.x, y: n.position.y }
  }
  relationshipStore.persistPositions(positions)
})

/* --------------------------- 关系编辑弹窗 --------------------------- */

const dialogOpen = ref(false)
/** 弹窗对应的两个 templateId（直接用 id，避免重名歧义） */
const dialogSourceId = ref<string | null>(null)
const dialogTargetId = ref<string | null>(null)

/** 适配 RelationshipEdgeDialog 的 Agent 接口（含 id: AgentId） */
const dialogSource = computed<TemplateNodeAgent | null>(() =>
  templateToNodeAgent(dialogSourceId.value),
)
const dialogTarget = computed<TemplateNodeAgent | null>(() =>
  templateToNodeAgent(dialogTargetId.value),
)

function templateToNodeAgent(templateId: string | null): TemplateNodeAgent | null {
  if (!templateId) return null
  const t = agentTemplates.value.find((a) => a.id === templateId)
  if (!t) return null
  const idx = agentTemplates.value.indexOf(t)
  return {
    id: 'A' as AgentId, // RelationshipEdgeDialog 用 id 做颜色解析的 fallback，实际不参与关系 key
    name: t.name,
    description: t.description,
    color: resolveColor(undefined, idx),
  }
}

function openEdgeDialog(sourceId: string, targetId: string) {
  dialogSourceId.value = sourceId
  dialogTargetId.value = targetId
  dialogOpen.value = true
}

const sourceToTarget = computed(() => {
  if (!dialogSourceId.value || !dialogTargetId.value) return ''
  return relationships.value[`${dialogSourceId.value}->${dialogTargetId.value}`] ?? ''
})

const targetToSource = computed(() => {
  if (!dialogSourceId.value || !dialogTargetId.value) return ''
  return relationships.value[`${dialogTargetId.value}->${dialogSourceId.value}`] ?? ''
})

function handleSave(a2b: string, b2a: string) {
  if (!dialogSourceId.value || !dialogTargetId.value) return
  relationshipStore.setPair(dialogSourceId.value, dialogTargetId.value, a2b, b2a)
  dialogOpen.value = false
}

function handleRemove() {
  if (!dialogSourceId.value || !dialogTargetId.value) return
  relationshipStore.removePair(dialogSourceId.value, dialogTargetId.value)
  // 移除画布上的连线
  const pairKey = [dialogSourceId.value, dialogTargetId.value].sort().join('-')
  const edgeId = `e-${pairKey}`
  // 原地移除，避免 Edge[] 赋值触发 vue-tsc TS2589 深度实例化
  const arr = edges.value
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]!.id === edgeId) {
      arr.splice(i, 1)
      break
    }
  }
  dialogOpen.value = false
}

/* --------------------------- 全屏切换 --------------------------- */

const isFullscreen = ref(false)

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  // 切换后重新 fitView
  setTimeout(() => {
    void vueFlow.fitView({ padding: 0.2, duration: 200 }).catch(() => {})
  }, 80)
}

/** 外部可通过 ESC 退出全屏 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isFullscreen.value) {
    isFullscreen.value = false
    setTimeout(() => {
      void vueFlow.fitView({ padding: 0.2, duration: 200 }).catch(() => {})
    }, 80)
  }
}

/* --------------------------- 统计 --------------------------- */

const agentCount = computed(() => agentTemplates.value.length)
const edgeCount = computed(() => edges.value.length)

/* --------------------------- 渲染初始化 --------------------------- */

watch(
  [agentTemplates, relationships],
  () => rebuildGraph(),
  { immediate: true, deep: true },
)

// 组件首次挂载后 fitView
setTimeout(() => {
  void vueFlow.fitView({ padding: 0.2, duration: 300 }).catch(() => {})
}, 100)

/* --------------------------- 节点着色工具 --------------------------- */

function nodeBorderHex(color: string) {
  return colorHex(color)
}
function nodeBgClass(color: string) {
  return bgColor(color).class
}
function nodeBgStyle(color: string) {
  return bgColor(color).style
}
function nodeTextClass(color: string) {
  return textColor(color).class
}
function nodeTextStyle(color: string) {
  return textColor(color).style
}
</script>

<template>
  <!-- 全屏时通过 Teleport 铺满 body -->
  <Teleport to="body" :disabled="!isFullscreen">
    <div
      :class="[
        'flex flex-col bg-white',
        isFullscreen
          ? 'fixed inset-0 z-[60]'
          : 'relative h-[min(70vh,32rem)] w-full',
      ]"
      @keydown="onKeydown"
    >
      <!-- 头部 -->
      <header
        class="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-2.5"
      >
        <div class="flex items-center gap-2 text-xs text-text-muted">
          <span>
            {{ agentCount }} 个智能体 · {{ edgeCount }} 条关系
          </span>
          <span class="hidden sm:inline">·</span>
          <span class="hidden sm:inline">
            拖拽节点定位 · 从节点边缘拖拽连线 · 点击连线编辑
          </span>
        </div>
        <button
          type="button"
          class="flex items-center gap-1 rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-text-dim transition-colors hover:bg-bg-hover hover:text-text-main"
          @click="toggleFullscreen"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <template v-if="!isFullscreen">
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
              <path d="M3 16v3a2 2 0 0 0 2 2h3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </template>
            <template v-else>
              <path d="M8 3v3a2 2 0 0 1-2 2H3" />
              <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
              <path d="M3 16h3a2 2 0 0 1 2 2v3" />
              <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
            </template>
          </svg>
          {{ isFullscreen ? '退出全屏' : '全屏' }}
        </button>
      </header>

      <!-- 画布区 -->
      <div class="relative min-h-0 flex-1 bg-bg-card">
        <!-- 空态：无智能体模板 -->
        <div
          v-if="agentCount === 0"
          class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center"
        >
          <p class="text-sm text-text-dim">还没有智能体模板</p>
          <p class="text-xs text-text-muted">
            先在「智能体模板」中添加至少 2 个角色，再回到这里建立关系
          </p>
        </div>

        <!-- 空态：有智能体但无关系 -->
        <div
          v-else-if="edgeCount === 0 && agentCount >= 2"
          class="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-white/90 px-4 py-2 text-xs text-text-muted shadow"
        >
          从节点右侧圆点拖拽到另一个节点，创建关系连线
        </div>

        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :default-edge-options="defaultEdgeOptions"
          :nodes-draggable="true"
          :nodes-connectable="true"
          fit-view-on-init
          class="h-full w-full"
        >
          <template #node-agent="nodeProps">
            <div
              class="relative min-w-[170px] max-w-[220px] rounded-xl border-2 bg-white px-3.5 py-2.5 shadow-md"
              :style="{ borderColor: nodeBorderHex(nodeProps.data.color) }"
            >
              <Handle
                type="target"
                :position="Position.Left"
                :style="{ background: nodeBorderHex(nodeProps.data.color) }"
              />
              <div class="mb-1 flex items-center gap-1.5">
                <span
                  class="h-2.5 w-2.5 rounded-full"
                  :class="nodeBgClass(nodeProps.data.color)"
                  :style="nodeBgStyle(nodeProps.data.color)"
                />
                <span
                  class="text-sm font-semibold"
                  :class="nodeTextClass(nodeProps.data.color)"
                  :style="nodeTextStyle(nodeProps.data.color)"
                >{{ nodeProps.data.name }}</span>
              </div>
              <p
                v-if="nodeProps.data.description"
                class="line-clamp-2 text-xs leading-relaxed text-text-dim"
              >
                {{ nodeProps.data.description }}
              </p>
              <p v-else class="text-xs text-text-muted">（未设定身份）</p>
              <p
                v-if="nodeProps.data.personality"
                class="mt-0.5 text-xs text-text-muted"
              >
                性格：{{ nodeProps.data.personality }}
              </p>
              <Handle
                type="source"
                :position="Position.Right"
                :style="{ background: nodeBorderHex(nodeProps.data.color) }"
              />
            </div>
          </template>
        </VueFlow>
      </div>
    </div>
  </Teleport>

  <!-- 关系编辑弹窗（与 RelationshipEdgeDialog 复用） -->
  <RelationshipEdgeDialog
    :open="dialogOpen"
    :source="dialogSource"
    :target="dialogTarget"
    :source-to-target="sourceToTarget"
    :target-to-source="targetToSource"
    @save="handleSave"
    @remove="handleRemove"
    @close="dialogOpen = false"
  />
</template>
