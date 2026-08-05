/**
 * 智能体颜色 → Tailwind class / inline style 映射工具。
 *
 * 两套着色路径：
 *  - 预设色（blue/pink/...）：走 Tailwind 字面量 class（text-agent-blue 等），
 *    所有 class 名以完整字符串出现于此文件，保证 v4 扫描命中。
 *  - 自定义色（#hex）：走 inline style，通过 CSS 变量 --agent-color 注入，
 *    组件用 :style 绑定。soft/透明效果用 color-mix() 实现。
 *
 * 组件统一调用 colorClass() / colorStyle() 取着色描述，二者择一：
 *  - 预设 → colorClass() 返回 class 串，colorStyle() 返回 {}
 *  - 自定义 → colorClass() 返回 ''，colorStyle() 返回 { '--agent-color': hex }
 */
import type { AgentColorValue, AgentPresetColor } from '@/types/api'
import { isPresetColor } from '@/types/api'
import { DEFAULT_AGENT_COLORS } from '@/types/api'

/** 预设色 → 文字色 class */
const AGENT_TEXT: Record<AgentPresetColor, string> = {
  blue: 'text-agent-blue',
  pink: 'text-agent-pink',
  green: 'text-agent-green',
  amber: 'text-agent-amber',
  purple: 'text-agent-purple',
  teal: 'text-agent-teal',
}

/** 预设色 → 圆点/实心背景 class */
const AGENT_BG: Record<AgentPresetColor, string> = {
  blue: 'bg-agent-blue',
  pink: 'bg-agent-pink',
  green: 'bg-agent-green',
  amber: 'bg-agent-amber',
  purple: 'bg-agent-purple',
  teal: 'bg-agent-teal',
}

/** 预设色 → 左强调条 class（气泡左侧 border） */
const AGENT_BORDER_L: Record<AgentPresetColor, string> = {
  blue: 'border-l-[3px] border-l-agent-blue',
  pink: 'border-l-[3px] border-l-agent-pink',
  green: 'border-l-[3px] border-l-agent-green',
  amber: 'border-l-[3px] border-l-agent-amber',
  purple: 'border-l-[3px] border-l-agent-purple',
  teal: 'border-l-[3px] border-l-agent-teal',
}

/** 预设色 → 右强调条 class（气泡右侧 border） */
const AGENT_BORDER_R: Record<AgentPresetColor, string> = {
  blue: 'border-r-[3px] border-r-agent-blue',
  pink: 'border-r-[3px] border-r-agent-pink',
  green: 'border-r-[3px] border-r-agent-green',
  amber: 'border-r-[3px] border-r-agent-amber',
  purple: 'border-r-[3px] border-r-agent-purple',
  teal: 'border-r-[3px] border-r-agent-teal',
}

/** 预设色 → 原始 hex 值（供非 Tailwind 场景如 Vue Flow edge style 使用） */
const AGENT_HEX: Record<AgentPresetColor, string> = {
  blue: '#2563eb',
  pink: '#db2777',
  green: '#16a34a',
  amber: '#d97706',
  purple: '#9333ea',
  teal: '#0d9488',
}

/* ----------------------- 统一取色：预设→class / 自定义→style ----------------------- */

/**
 * 取文字色 class（预设色）。自定义色返回空串（需配合 colorStyle 用 inline）。
 */
export function colorTextClass(color: AgentColorValue): string {
  return isPresetColor(color) ? AGENT_TEXT[color] : ''
}

/** 取实心背景 class（预设色）。自定义色返回空串。 */
export function colorBgClass(color: AgentColorValue): string {
  return isPresetColor(color) ? AGENT_BG[color] : ''
}

/** 取左强调条 class（预设色）。自定义色返回空串。 */
export function colorBorderLClass(color: AgentColorValue): string {
  return isPresetColor(color) ? AGENT_BORDER_L[color] : ''
}

/** 取右强调条 class（预设色）。自定义色返回空串。 */
export function colorBorderRClass(color: AgentColorValue): string {
  return isPresetColor(color) ? AGENT_BORDER_R[color] : ''
}

/**
 * 自定义色的 inline style：注入 --agent-color 变量。
 * 组件根元素绑定后，子元素可用 var(--agent-color) 引用。
 * 预设色返回空对象（走 class）。
 */
export function colorStyle(color: AgentColorValue): Record<string, string> {
  if (isPresetColor(color)) return {}
  return { '--agent-color': color }
}

/**
 * 统一文字着色：预设→class，自定义→inline color + CSS 变量。
 * 返回 { class, style } 供组件分别绑定 :class 和 :style。
 */
export function textColor(color: AgentColorValue): { class: string; style: Record<string, string> } {
  if (isPresetColor(color)) return { class: AGENT_TEXT[color], style: {} }
  return { class: '', style: { '--agent-color': color, color: 'var(--agent-color)' } }
}

/** 统一实心背景着色 */
export function bgColor(color: AgentColorValue): { class: string; style: Record<string, string> } {
  if (isPresetColor(color)) return { class: AGENT_BG[color], style: {} }
  return { class: '', style: { '--agent-color': color, backgroundColor: 'var(--agent-color)' } }
}

/** 统一左强调条着色 */
export function borderLColor(color: AgentColorValue): { class: string; style: Record<string, string> } {
  if (isPresetColor(color)) return { class: AGENT_BORDER_L[color], style: {} }
  return { class: 'border-l-[3px]', style: { '--agent-color': color, borderLeftColor: 'var(--agent-color)' } }
}

/** 统一右强调条着色 */
export function borderRColor(color: AgentColorValue): { class: string; style: Record<string, string> } {
  if (isPresetColor(color)) return { class: AGENT_BORDER_R[color], style: {} }
  return { class: 'border-r-[3px]', style: { '--agent-color': color, borderRightColor: 'var(--agent-color)' } }
}

/**
 * 取智能体颜色值；缺省时按索引回退默认色（循环）。
 */
export function resolveColor(color: AgentColorValue | undefined, index: number): AgentColorValue {
  return color || DEFAULT_AGENT_COLORS[index % DEFAULT_AGENT_COLORS.length] || 'blue'
}

/**
 * 取颜色的原始 hex 值（供非 Tailwind 场景使用，如 Vue Flow edge style）。
 * 预设色查表，自定义色原样返回。
 */
export function colorHex(color: AgentColorValue): string {
  if (isPresetColor(color)) return AGENT_HEX[color]
  return color
}

// 向后兼容：旧代码直接引用 AGENT_BG / AGENT_TEXT 等表的导出
export { AGENT_BG, AGENT_TEXT }
