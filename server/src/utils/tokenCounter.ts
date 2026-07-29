/**
 * 粗略估算 token 数（仅用于「未发送前的预防性检查」）。
 * 实际计费/熔断以 API 返回的 usage 为准。
 * 中文按字符数估算，英文按 4 字符/token 估算。
 */
export function estimateTokens(text: string = ''): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) cjk++
    else other++
  }
  return Math.ceil(cjk * 1.5 + other / 4)
}

/** estimateMessagesTokens 的入参消息（仅需 content 字段） */
interface TokenEstimableMessage {
  content?: string
}

export function estimateMessagesTokens(messages: TokenEstimableMessage[] = []): number {
  let total = 0
  for (const m of messages) {
    total += 4 // role + 结构开销
    total += estimateTokens(m.content || '')
  }
  return total
}
