# 开发计划审核报告（归档）

> 审核时间：2026-07-26
> 审核方：子智能体（general-purpose，资深全栈架构师视角）
> 审核对象：DEVELOPMENT_PLAN.md v1.0

## 审核结论

**NEEDS_REVISION → 经修订后升级为 APPROVED_WITH_MINOR_ISSUES**

子智能体提出 5 个"硬伤"。复核结论：

| # | 子智能体意见 | 主控复核 | 处理 |
|---|---|---|---|
| 硬伤 1 | 质疑 v4-flash 不存在、reasoning_content 是 R1 独有 | **误判**：基于过时训练语料。已二次 curl 实测，真实返回见 RESEARCH_NOTES.md §1 原文。模型确为 deepseek-v4-flash，且 reasoning_content 与 content 同时返回 | 驳回该意见，保留原模型；但强化「只取 content」契约写法 |
| 硬伤 2 | 数据模型缺 error 状态、finishedReason；round/turn 定义自相矛盾 | **有效** | 已修订 §5.1 |
| 硬伤 3 | 本地 dev 的 WS 代理方向未说清 | **有效** | 已修订 §5.6，采用单端口方案 |
| 硬伤 4 | 定时 flush 会丢数据；缺崩溃恢复 | **有效** | 已修订 §5.7 持久化策略 |
| 硬伤 5 | 无限对话无熔断、无成本展示 | **有效** | 已修订 §5.8 熔断 + §5.5 stats 推送 |

第二部分"实现中修正项"全部采纳，已在 §5 各小节落地。

## 采纳的具体改进点（已写入 DEVELOPMENT_PLAN v1.1）

### 数据模型（§5.1）
- 增加 `status: "error"` 状态
- 增加 `finishedReason` 持久化字段
- 统一术语：**1 round = A 发言 + B 发言（两条 message）**；
  `messageCount` = 已发言条数；`round = floor(messageCount/2)`
- 摘要触发按 **round** 计（每 N round 触发一次）

### 双 AI 上下文（§5.1、§5.2）
- A 首次发言前注入「开场 user 提示」解决无 user 消息问题
- B 的 user 消息内容统一加前缀 `[{{AName}}]: `，避免 B 误以为自言自语
- `session.messages` 改为「展示流」，仅存元数据 + content，不再三份冗余
- 拼对方 user 消息时**只取 content，丢弃 reasoning_content**（硬契约）

### 摘要（§5.3）
- 修订第一人称 prompt：「以 {{agentName}} 的第一人称视角重写摘要，仿佛是它自己的日记」
- 增加「保留旧摘要关键事实原句，只追加新事实」防漂移
- 摘要调用计入 stats.totalTokens；摘要复用同模型但温度降到 0.3

### 调度循环（§5.2）
- 每次 API 调用套 `AbortController` + 30s 超时
- 流式中断：已收 chunk 拼接为 truncated 消息落盘 + 推 error + 跳出
- 用户 stop 时**立即 abort 当前 fetch**，不等流结束
- 同 session 重复 start：仅 idle/stopped/finished/error 可 start
- WS 断开不影响循环；新连接推 `{type:"sync"}` 全量同步

### 持久化（§5.7，新章节）
- 每条 message_done **同步落盘**（append 到会话 JSON）
- graceful shutdown：SIGINT/SIGTERM 把所有 running 标记 stopped 并 flush
- 启动恢复：把 `status==="running"` 的全部改为 `stopped`

### 部署（§5.6）
- 采用**单端口方案**：dev/prod 都走后端 3000 端口托管
  - dev：Fastify 用 `@fastify/vite` 或 vite dev middleware 挂载
  - prod：`@fastify/static` 托管 `server/public`，SPA fallback index.html
- 启动时 fail-fast 校验 `DEEPSEEK_API_KEY`、`PORT`
- 端口冲突时 `PORT=0` 自动分配
- 自动打开浏览器：探测 `open`/`xdg-open`/`start`，失败只打印 URL

### 熔断与成本（§5.8，新章节）
- 全局硬熔断：`ABSOLUTE_MAX_ROUNDS=200`、`ABSOLUTE_MAX_DURATION_SEC=7200`（env 可配）
- WS 推 `{type:"stats", totalTokens, totalCost}` 每轮结束推送
- 前端顶部常驻显示 token 与估算成本
- 设置区加醒目提示「无限对话会产生持续 API 费用」

### 验收清单（§8）
- 增加「30 轮后 A 的 messages 不含 B 的 system prompt」可测条目
- 增加「触发摘要后下次调用 messages 中有 [对话进展摘要] 注入且条数降至 keepRecent」
- 增加「关浏览器重开历史对话仍在」
- 增加「API Key 错误/网络断开时前端有清晰提示」

### 其他
- 根目录用 npm workspaces 管理 server/web
- system prompt 模板要求 AI「避免重复对方刚说的话、主动推进话题」防复读
- 默认温度从 0.8 降到 0.7

## 结论
**APPROVED_WITH_MINOR_ISSUES — 修订完成，进入实施。**
