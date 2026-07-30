import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import config from '../config.js'
import type {
  Provider,
  ProviderFormData,
  ProviderListItem,
  ProvidersFile,
} from '../types/index.js'

/** 新增 Provider 时的默认单价（参考价，用户可在 UI 修改） */
const DEFAULT_INPUT_PER_MTOK = 0.27
const DEFAULT_OUTPUT_PER_MTOK = 1.10

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
    inputPerMTok: p.inputPerMTok,
    outputPerMTok: p.outputPerMTok,
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
    inputPerMTok: data.inputPerMTok ?? DEFAULT_INPUT_PER_MTOK,
    outputPerMTok: data.outputPerMTok ?? DEFAULT_OUTPUT_PER_MTOK,
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
    inputPerMTok: data.inputPerMTok ?? old.inputPerMTok,
    outputPerMTok: data.outputPerMTok ?? old.outputPerMTok,
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
