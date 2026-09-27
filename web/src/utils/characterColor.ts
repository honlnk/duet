/**
 * 角色颜色 → Tailwind class / inline style 映射工具。
 *
 * 两套着色路径：
 *  - 预设色（blue/pink/...）：走 Tailwind 字面量 class（text-character-blue 等），
 *    所有 class 名以完整字符串出现于此文件，保证 v4 扫描命中。
 *  - 自定义色（#hex）：走 inline style，通过 CSS 变量 --character-color 注入，
 *    组件用 :style 绑定。soft/透明效果用 color-mix() 实现。
 *
 * 组件统一调用 colorClass() / colorStyle() 取着色描述，二者择一：
 *  - 预设 → colorClass() 返回 class 串，colorStyle() 返回 {}
 *  - 自定义 → colorClass() 返回 ''，colorStyle() 返回 { '--character-color': hex }
 */
import type { CharacterColorValue, CharacterPresetColor } from '@/types/api'
import { isPresetColor } from '@/types/api'
import { DEFAULT_CHARACTER_COLORS } from '@/types/api'

/** 预设色 → 文字色 class */
const CHARACTER_TEXT: Record<CharacterPresetColor, string> = {
  blue: 'text-character-blue',
  pink: 'text-character-pink',
  green: 'text-character-green',
  amber: 'text-character-amber',
  purple: 'text-character-purple',
  teal: 'text-character-teal',
}

/** 预设色 → 圆点/实心背景 class */
const CHARACTER_BG: Record<CharacterPresetColor, string> = {
  blue: 'bg-character-blue',
  pink: 'bg-character-pink',
  green: 'bg-character-green',
  amber: 'bg-character-amber',
  purple: 'bg-character-purple',
  teal: 'bg-character-teal',
}

/** 预设色 → 左强调条 class（气泡左侧 border） */
const CHARACTER_BORDER_L: Record<CharacterPresetColor, string> = {
  blue: 'border-l-[3px] border-l-character-blue',
  pink: 'border-l-[3px] border-l-character-pink',
  green: 'border-l-[3px] border-l-character-green',
  amber: 'border-l-[3px] border-l-character-amber',
  purple: 'border-l-[3px] border-l-character-purple',
  teal: 'border-l-[3px] border-l-character-teal',
}

/** 预设色 → 右强调条 class（气泡右侧 border） */
const CHARACTER_BORDER_R: Record<CharacterPresetColor, string> = {
  blue: 'border-r-[3px] border-r-character-blue',
  pink: 'border-r-[3px] border-r-character-pink',
  green: 'border-r-[3px] border-r-character-green',
  amber: 'border-r-[3px] border-r-character-amber',
  purple: 'border-r-[3px] border-r-character-purple',
  teal: 'border-r-[3px] border-r-character-teal',
}

/** 预设色 → 原始 hex 值（供非 Tailwind 场景如 Vue Flow edge style 使用） */
const CHARACTER_HEX: Record<CharacterPresetColor, string> = {
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
export function colorTextClass(color: CharacterColorValue): string {
  return isPresetColor(color) ? CHARACTER_TEXT[color] : ''
}

/** 取实心背景 class（预设色）。自定义色返回空串。 */
export function colorBgClass(color: CharacterColorValue): string {
  return isPresetColor(color) ? CHARACTER_BG[color] : ''
}

/** 取左强调条 class（预设色）。自定义色返回空串。 */
export function colorBorderLClass(color: CharacterColorValue): string {
  return isPresetColor(color) ? CHARACTER_BORDER_L[color] : ''
}

/** 取右强调条 class（预设色）。自定义色返回空串。 */
export function colorBorderRClass(color: CharacterColorValue): string {
  return isPresetColor(color) ? CHARACTER_BORDER_R[color] : ''
}

/**
 * 自定义色的 inline style：注入 --character-color 变量。
 * 组件根元素绑定后，子元素可用 var(--character-color) 引用。
 * 预设色返回空对象（走 class）。
 */
export function colorStyle(color: CharacterColorValue): Record<string, string> {
  if (isPresetColor(color)) return {}
  return { '--character-color': color }
}

/**
 * 统一文字着色：预设→class，自定义→inline color + CSS 变量。
 * 返回 { class, style } 供组件分别绑定 :class 和 :style。
 */
export function textColor(color: CharacterColorValue): { class: string; style: Record<string, string> } {
  if (isPresetColor(color)) return { class: CHARACTER_TEXT[color], style: {} }
  return { class: '', style: { '--character-color': color, color: 'var(--character-color)' } }
}

/** 统一实心背景着色 */
export function bgColor(color: CharacterColorValue): { class: string; style: Record<string, string> } {
  if (isPresetColor(color)) return { class: CHARACTER_BG[color], style: {} }
  return { class: '', style: { '--character-color': color, backgroundColor: 'var(--character-color)' } }
}

/** 统一左强调条着色 */
export function borderLColor(color: CharacterColorValue): { class: string; style: Record<string, string> } {
  if (isPresetColor(color)) return { class: CHARACTER_BORDER_L[color], style: {} }
  return { class: 'border-l-[3px]', style: { '--character-color': color, borderLeftColor: 'var(--character-color)' } }
}

/** 统一右强调条着色 */
export function borderRColor(color: CharacterColorValue): { class: string; style: Record<string, string> } {
  if (isPresetColor(color)) return { class: CHARACTER_BORDER_R[color], style: {} }
  return { class: 'border-r-[3px]', style: { '--character-color': color, borderRightColor: 'var(--character-color)' } }
}

/**
 * 取角色颜色值；缺省时按索引回退默认色（循环）。
 */
export function resolveColor(color: CharacterColorValue | undefined, index: number): CharacterColorValue {
  return color || DEFAULT_CHARACTER_COLORS[index % DEFAULT_CHARACTER_COLORS.length] || 'blue'
}

/**
 * 取颜色的原始 hex 值（供非 Tailwind 场景使用，如 Vue Flow edge style）。
 * 预设色查表，自定义色原样返回。
 */
export function colorHex(color: CharacterColorValue): string {
  if (isPresetColor(color)) return CHARACTER_HEX[color]
  return color
}

// 向后兼容：旧代码直接引用 CHARACTER_BG / CHARACTER_TEXT 等表的导出
export { CHARACTER_BG, CHARACTER_TEXT }
