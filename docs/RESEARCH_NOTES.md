# 调研笔记 — Duet 双 AI 对话聊天室

## 1. DeepSeek API 实测结果（2026-07-26，已二次复核）

> 说明：子智能体审核曾质疑「v4-flash 不存在 / reasoning_content 是 R1 独有」，
> 该判断基于过时训练语料。以下为真实 curl 输出原文，已二次复核确认。

### 1.1 可用模型 — GET /v1/models
```bash
curl -s https://api.deepseek.com/v1/models \
  -H "Authorization: Bearer sk-***"
```
返回（原文）：
```json
{
  "object": "list",
  "data": [
    {"id":"deepseek-v4-flash","object":"model","owned_by":"deepseek"},
    {"id":"deepseek-v4-pro","object":"model","owned_by":"deepseek"}
  ]
}
```
旧的 `deepseek-chat` 已被服务端拒绝（实测返回 `invalid_request_error`，
提示"supported API model names are deepseek-v4-pro or deepseek-v4-flash"）。

### 1.2 chat/completions（非流式）— 真实返回
```bash
curl -X POST https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer sk-***" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"system","content":"你是助手"},
       {"role":"user","content":"回复两个字：你好"}],"max_tokens":20,"stream":false}'
```
返回（原文，已确认 v4-flash 同时返回 content 与 reasoning_content）：
```json
{
  "id":"336a2bb0-b053-415a-b11e-9ea92fe40471",
  "object":"chat.completion",
  "created":1784998230,
  "model":"deepseek-v4-flash",
  "choices":[{"index":0,"message":{
    "role":"assistant",
    "content":"你好",
    "reasoning_content":"我们被要求回复两个字："你好"。所以直接输出"你好"即可。",
    "logprobs":null,"finish_reason":"stop"
  }}],
  "usage":{
    "prompt_tokens":10,
    "completion_tokens":18,
    "total_tokens":28,
    "prompt_tokens_details":{"cached_tokens":0},
    "completion_tokens_details":{"reasoning_tokens":16},
    "prompt_cache_hit_tokens":0,
    "prompt_cache_miss_tokens":10
  },
  "system_fingerprint":"fp_8b330d02d0_prod0820_fp8_kvcache_20260402"
}
```
**关键事实**：
- 兼容 OpenAI Chat Completions 格式。
- `message.content` 是正式回复，`message.reasoning_content` 是思维链。
- `usage` 字段精确可用（`prompt_tokens` / `completion_tokens` / `total_tokens`，
  含 `reasoning_tokens` 拆分）。**直接用 API 返回的 usage 计费/熔断，无需本地估算**。

### 1.3 chat/completions（流式）— 真实事件序列
设 `stream:true`，SSE 事件序列（节选）：
```
data: {"...","choices":[{"index":0,"delta":{"role":"assistant","content":null,"reasoning_content":""},"finish_reason":null}]}

data: {"...","choices":[{"index":0,"delta":{"content":null,"reasoning_content":"我们"},"finish_reason":null}]}
data: {"...","choices":[{"index":0,"delta":{"content":null,"reasoning_content":"要求"},"finish_reason":null}]}
... (reasoning_content 逐 token 流式)
... (随后切换到 content 逐 token 流式)
data: {"...","choices":[{"index":0,"delta":{"content":"说","reasoning_content":null},"finish_reason":null}]}
...
data: [DONE]
```
**关键事实**：
- 流式时 `delta` 中 `content` 与 `reasoning_content` 是**分阶段**到达：先吐
  `reasoning_content`，再吐 `content`。每个 chunk 里二者其一为 `null`。
- 前端只渲染 `content`；`reasoning_content` 仅用于后端调试日志。
- 结束标志：`data: [DONE]`。
- **重要契约**：拼装「对方 AI 的 user 消息」时**只取 content**，
  严禁把 reasoning_content 当成对话内容塞给对方 AI（会泄露思维链、污染对方记忆）。

## 2. SillyTavern（酒馆）长记忆机制要点

### 2.1 上下文优先级（prompt_order）
固定优先级从高到低：main(system) → worldInfo → persona → charDescription → ... →
**chatHistory（最易被裁）** → jailbreak。预算不够时优先丢最旧的 chatHistory。

### 2.2 Summarize 插件默认参数
| 参数 | 值 |
|---|---|
| promptInterval | 10 条消息触发一次 |
| promptWords | 200 词 |
| depth | 2（注入到倒数第 2 条处）|
| role | SYSTEM |
| 滚动摘要 | 新摘要在旧摘要基础上递增 |

### 2.3 摘要 Prompt（原版）
```
Ignore previous instructions. Summarize the most important facts and events
in the story so far. If a summary already exists in your memory, use that as
a base and expand with new facts. Limit the summary to {{words}} words or less.
Your response should include nothing but the summary.
```
注入模板：`[Summary: {{summary}}]`

### 2.4 双 AI 场景的适配建议
- 每个 AI 物理隔离的 messages/summary 存储。
- 摘要以**第一人称自己视角**写，避免把对方幻觉当自己记忆。
- 摘要固定记录「话题 / 双方立场 / 共识 / 待办」，防漂移。
- 双 AI 对话 token 增长快且冗余，**轮数阈值比 token 阈值更灵敏**。

## 3. 结论
技术栈与参数已在 DEVELOPMENT_PLAN.md §2、§3、§5 中固化。
API 实测结论以本文 §1 的真实 curl 输出为准。
