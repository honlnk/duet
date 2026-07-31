import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import config from '../config.js'
import {
  FALLBACK_INPUT_PER_MTOK,
  FALLBACK_OUTPUT_PER_MTOK,
} from '../utils/cost.js'
import type {
  Provider,
  ProviderFormData,
  ProviderListItem,
  ProviderPricing,
  ProvidersFile,
} from '../types/index.js'

/**
 * 归一化价格配置：补全缺失字段。
 * - currency 缺失 → 默认 'CNY'
 * - 缓存命中单价缺失 → 取输入单价的 1/4（DeepSeek 经验值）
 * - 缓存写入单价缺失 → 0（默认关闭，需用户显式开启）
 */
function normalizePricing(p?: Partial<ProviderPricing> | null): ProviderPricing {
  const input = Number(p?.inputPerMTok)
  const inputPerMTok = Number.isFinite(input) && input >= 0 ? input : FALLBACK_INPUT_PER_MTOK

  const output = Number(p?.outputPerMTok)
  const outputPerMTok =
    Number.isFinite(output) && output >= 0 ? output : FALLBACK_OUTPUT_PER_MTOK

  const cacheHit = Number(p?.cacheHitPerMTok)
  const cacheHitPerMTok =
    Number.isFinite(cacheHit) && cacheHit >= 0 ? cacheHit : round4(inputPerMTok * 0.25)

  const cacheWrite = Number(p?.cacheWritePerMTok)
  const cacheWritePerMTok = Number.isFinite(cacheWrite) && cacheWrite >= 0 ? cacheWrite : 0

  return {
    currency: typeof p?.currency === 'string' && p.currency.trim() ? p.currency.trim() : 'CNY',
    inputPerMTok,
    outputPerMTok,
    cacheHitEnabled: p?.cacheHitEnabled ?? true,
    cacheHitPerMTok,
    cacheWriteEnabled: p?.cacheWriteEnabled ?? false,
    cacheWritePerMTok,
  }
}

/** 保留 4 位小数（单价展示用） */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/** 空文件结构 */
function emptyFile(): ProvidersFile {
  return { providers: [], defaultId: '' }
}

/**
 * 从磁盘读取完整 Provider 配置。
 * 文件不存在或损坏时返回空结构（不抛错，让调用方决定后续行为）。
 */
function loadRaw(): ProvidersFile {
  const file = config.providersFile
  if (!fs.existsSync(file)) return emptyFile()
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as ProvidersFile
    if (!Array.isArray(parsed.providers)) return emptyFile()
    // 补全旧数据缺的 protocol 字段（默认 openai）
    let dirty = false
    for (const p of parsed.providers) {
      if (!p.protocol) {
        p.protocol = 'openai'
        dirty = true
      }
    }
    if (dirty) saveRaw(parsed)
    return parsed
  } catch (e) {
    console.error('[provider] 配置文件损坏:', e instanceof Error ? e.message : e)
    return emptyFile()
  }
}

/** 原子写入（tmp + rename，与 sessionStore 一致） */
function saveRaw(data: ProvidersFile): void {
  const file = config.providersFile
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 把 apiKey 打码为 sk-***后四位 的形式，供前端列表展示。
 * 短 key 全部打码。
 */
function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 6) return '***'
  const tail = key.slice(-4)
  const prefix = key.slice(0, 3)
  return `${prefix}***${tail}`
}

/** Provider → 列表项（打码） */
function toListItem(p: Provider): ProviderListItem {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
    protocol: p.protocol,
    pricing: p.pricing,
    apiKeyMasked: maskKey(p.apiKey),
  }
}

/* ----------------------------- 读取 ----------------------------- */

/** 返回打码后的列表 + 默认 id（给前端用） */
export function listProviderItems(): { providers: ProviderListItem[]; defaultId: string } {
  const data = loadRaw()
  return {
    providers: data.providers.map(toListItem),
    defaultId: data.defaultId,
  }
}

/** 按 id 查找完整 Provider（含真实 key，供 AI 调用层用） */
export function getProvider(id: string): Provider | null {
  const data = loadRaw()
  return data.providers.find((p) => p.id === id) ?? null
}

/** 返回当前默认 Provider（完整含 key） */
export function getDefaultProvider(): Provider | null {
  const data = loadRaw()
  return data.providers.find((p) => p.id === data.defaultId) ?? data.providers[0] ?? null
}

/**
 * 解析会话配置中的 provider 引用：
 * - id 为空 → 默认 Provider
 * - id 找不到 → 也回落到默认 Provider（容错）
 * - 全都没有 → 返回 null（调用方需处理）
 */
export function resolveProvider(id?: string): Provider | null {
  if (id) {
    const found = getProvider(id)
    if (found) return found
    console.warn(`[provider] id=${id} 不存在，回落到默认 Provider`)
  }
  return getDefaultProvider()
}

/* ----------------------------- 写入 ----------------------------- */

/** 新增 Provider。返回完整对象（含生成的 id） */
export function addProvider(data: ProviderFormData): Provider {
  const file = loadRaw()
  const provider: Provider = {
    id: 'prov_' + randomUUID(),
    name: data.name.trim() || '未命名 Provider',
    baseUrl: data.baseUrl.trim() || 'https://api.deepseek.com/v1',
    apiKey: data.apiKey.trim(),
    model: data.model.trim() || 'deepseek-v4-flash',
    protocol: data.protocol ?? 'openai',
    pricing: normalizePricing(data.pricing),
  }
  file.providers.push(provider)
  // 第一条自动设为默认
  if (!file.defaultId) file.defaultId = provider.id
  saveRaw(file)
  return provider
}

/** 更新已有 Provider。返回更新后的对象，找不到返回 null。 */
export function updateProvider(id: string, data: Partial<ProviderFormData>): Provider | null {
  const file = loadRaw()
  const idx = file.providers.findIndex((p) => p.id === id)
  if (idx === -1) return null
  const old = file.providers[idx]!
  file.providers[idx] = {
    ...old,
    name: data.name != null ? (data.name.trim() || old.name) : old.name,
    baseUrl: data.baseUrl != null ? (data.baseUrl.trim() || old.baseUrl) : old.baseUrl,
    // apiKey 为空字符串时视为「不修改」（前端编辑时若未重填则不改 key）
    apiKey: data.apiKey != null && data.apiKey.trim() ? data.apiKey.trim() : old.apiKey,
    model: data.model != null ? (data.model.trim() || old.model) : old.model,
    protocol: data.protocol ?? old.protocol,
    // pricing 为部分更新：以旧值为底，用传入字段覆盖后归一化
    pricing:
      data.pricing != null ? normalizePricing({ ...old.pricing, ...data.pricing }) : old.pricing,
  }
  saveRaw(file)
  return file.providers[idx]!
}

/** 删除 Provider。不允许删除默认 Provider。返回是否成功。 */
export function deleteProvider(id: string): { ok: boolean; reason?: string } {
  const file = loadRaw()
  if (!file.providers.find((p) => p.id === id)) {
    return { ok: false, reason: 'Provider 不存在' }
  }
  if (file.defaultId === id) {
    return { ok: false, reason: '不能删除默认 Provider' }
  }
  file.providers = file.providers.filter((p) => p.id !== id)
  saveRaw(file)
  return { ok: true }
}

/** 设定默认 Provider */
export function setDefaultProvider(id: string): boolean {
  const file = loadRaw()
  if (!file.providers.find((p) => p.id === id)) return false
  file.defaultId = id
  saveRaw(file)
  return true
}

/* ----------------------------- 启动校验 ----------------------------- */

/**
 * 启动校验：确认至少有一条 Provider 可用。
 * 无 Provider 时在 dev 模式仅 warn，prod 模式报错退出。
 */
export function validateProviders(): void {
  const data = loadRaw()
  if (data.providers.length === 0) {
    if (config.env === 'production') {
      console.error('[provider] 无可用 Provider。请在 UI 中添加至少一个模型连接。')
      process.exit(1)
    } else {
      console.warn('[provider] 警告：无可用 Provider，AI 调用将失败。请在 UI 中添加。')
    }
  } else if (!data.defaultId || !data.providers.find((p) => p.id === data.defaultId)) {
    // defaultId 指向不存在的项 → 自动修正为第一条
    const data2 = loadRaw()
    data2.defaultId = data2.providers[0]!.id
    saveRaw(data2)
  }
}
