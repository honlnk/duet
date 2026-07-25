# Duet — 双 AI 自主对话聊天室 开发计划

> 版本：v1.1（已通过子智能体审核并修订）  日期：2026-07-26
> 状态：**APPROVED_WITH_MINOR_ISSUES — 进入实施**
> 审核记录见 `docs/REVIEW.md`

## 1. 项目目标

构建一个「双 AI 自主对话聊天室」工具：

- 用户输入一个**话题**与**两个 AI 的身份设定**，点击「开始」即让两个 AI 自动互相聊天。
- 支持设置**对话轮数上限**或**持续时间上限**；不设置则**无限对话**，直到用户点击「停止」。
- 两个 AI **各自维护独立的上下文记忆**，互不混淆身份。
- 自动**压缩长对话上下文**（参考 SillyTavern 酒馆的 Summarize 机制）。
- 同时支持**远程服务器部署**与**本地 CLI 启动**（浏览器打开页面）。

## 2. 调研结论（关键约束）

### 2.1 DeepSeek API（已实测，真实返回见 RESEARCH_NOTES.md §1）
- Endpoint：`https://api.deepseek.com/v1/chat/completions`（OpenAI 兼容）。
- 可用模型（GET /v1/models 实测）：`deepseek-v4-flash`、`deepseek-v4-pro`。
- **本项目默认使用 `deepseek-v4-flash`**。
- 认证：`Authorization: Bearer <API_KEY>`。
- 支持 `stream: true` 流式响应（SSE，`data: {...}\n\n`，结尾 `data: [DONE]`）。
- **响应契约**：`message.content` 是正式回复，`message.reasoning_content` 是思维链。
  - 前端只渲染 `content`；`reasoning_content` 仅用于后端调试日志。
  - 流式 chunk 中 `content` 与 `reasoning_content` 分阶段到达（先 reasoning 后 content），每个 chunk 二者其一为 null。
  - **硬契约**：拼装「对方 AI 的 user 消息」时**只取 content**，严禁把 reasoning_content 当对话内容塞给对方 AI。
- `usage` 字段精确可用：`prompt_tokens` / `completion_tokens` / `total_tokens`（含 `reasoning_tokens` 拆分）。**直接用 API 返回的 usage 做熔断/计费，不做本地估算**。

### 2.2 长记忆机制（参考 SillyTavern）
「**摘要压缩 + 滑动窗口**」组合（v1 不做向量检索，保持轻量）：

| 参数 | 推荐值 | 说明 |
|---|---|---|
| 触发条件（轮数）| 每 **10 round** 触发一次摘要 | 1 round = A 发言 + B 发言 |
| 触发条件（token）| 单个 AI 上下文达 **75%** 时强制触发 | 即约 48k token（按 64k 上下文估算）|
| 摘要目标长度 | **约 200 词** | 注入回上下文 |
| 滑动窗口保留 | **最近 8 条原始消息** | 压缩后只保留近况 |
| 摘要注入位置 | system 角色，置于对话历史前段 | `[对话进展摘要: ...]` |

**双 AI 独立记忆关键点**：
1. 每个 AI 拥有独立的 `messages[]` 数组与独立的 `summary` 字段，物理隔离。
2. 摘要以「**第一人称自己视角**」撰写。
3. 摘要固定记录：当前话题、双方立场、已达成共识、待讨论点。

### 2.3 术语统一定义（修订）
- **message**：一次 AI 发言（一条 assistant 输出）。
- **round**：1 round = A 发言 + B 发言 = 2 条 message。
- **messageCount**：会话累计发言条数；**round = floor(messageCount / 2)**。
- 「对话轮数上限」= round 上限；「摘要频率」按 round 计。

## 3. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | **Node.js (v20+)** | 已装 v24；单语言栈前后端统一 |
| 后端框架 | **Fastify** | 比 Express 快、内置 schema、插件体系清晰 |
| 实时通信 | **WebSocket (ws)** | AI 对话流式 + 对方 AI 接力，需双向推送 |
| AI 调用 | **原生 fetch + SSE 解析** | 不依赖 OpenAI SDK，零额外依赖 |
| 前端 | **原生 HTML/CSS/JS + Vite** | 单页应用，降低部署复杂度 |
| 前端集成 | **后端单端口托管**（dev 用 vite middleware，prod 用 @fastify/static）| 单进程单端口，零代理 |
| 持久化 | **JSON 文件（每条 message_done 同步落盘）** | v1 不引入数据库 |
| 进程管理 | CLI 直接 `node server.js` | 远程用 pm2/systemd |
| 配置 | `.env` + 环境变量 + 校验 | API Key、端口、模型名、熔断阈值 |
| Monorepo | **npm workspaces** | 根 package.json 管理 server/web |

## 4. 项目结构

```
duet/
├── docs/                      # 文档
│   ├── DEVELOPMENT_PLAN.md    # 本文件
│   ├── RESEARCH_NOTES.md      # API 实测原文
│   └── REVIEW.md              # 审核报告
├── package.json               # 根 workspaces
├── .env.example
├── .gitignore
├── README.md
├── server/                    # 后端 workspace
│   ├── package.json
│   └── src/
│       ├── index.js           # 入口：Fastify + WS + 静态托管 + graceful shutdown
│       ├── config.js          # 环境变量加载 + fail-fast 校验
│       ├── routes/
│       │   ├── sessions.js    # REST: 会话 CRUD
│       │   └── health.js
│       ├── ws/
│       │   └── chatHandler.js # WebSocket 主逻辑：双 AI 调度
│       ├── ai/
│       │   ├── deepseek.js    # DeepSeek 客户端（SSE 流式 + AbortController）
│       │   └── prompts.js     # system prompt + 摘要 prompt 模板
│       ├── memory/
│       │   ├── context.js     # 单 AI 上下文管理（窗口+摘要注入）
│       │   └── summarizer.js  # 摘要生成器（第一人称视角）
│       ├── store/
│       │   └── sessionStore.js# 会话持久化（同步落盘 + 启动恢复）
│       └── utils/
│           └── cost.js        # token -> 估算成本
├── web/                       # 前端 workspace
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.js            # 入口
│       ├── api.js             # WebSocket + REST 封装
│       ├── ui.js              # DOM 渲染
│       └── styles.css
└── data/                      # 运行时数据（gitignore）
    └── sessions/              # 每会话一个 JSON
```

## 5. 详细设计

### 5.1 数据模型

**Session（一个对话房间）**
```js
{
  id: "sess_<uuid>",
  topic: "讨论是否应该立法禁止AI生成未标注内容",
  agents: [
    { id: "A", name: "支持者", persona: "你是一名坚定支持立法的伦理学家..." },
    { id: "B", name: "反对者", persona: "你是一名关注言论自由的法学家..." }
  ],
  config: {
    maxRounds: 20,         // round 上限；0/null = 无限（仍受全局熔断）
    durationSec: 0,        // 0 = 无限（仍受全局熔断）
    model: "deepseek-v4-flash",
    temperature: 0.7,      // 默认 0.7（修订自 0.8，降低漂移）
    summaryEveryN: 10,     // 每 10 round 触发摘要
    keepRecent: 8          // 压缩后保留最近 8 条原始消息
  },
  status: "idle|running|stopped|finished|error",  // 修订：含 error
  finishedReason: null,    // 修订：持久化结束原因
  // 可能值: "max_rounds" | "duration" | "stopped" | "absolute_limit" | "error" | null
  startedAt: null,
  stoppedAt: null,
  messageCount: 0,         // 修订：累计发言条数
  // round = floor(messageCount / 2)，不单独存
  currentAgentId: "A",     // 下一个该发言的 AI
  messages: [              // 展示流（修订：仅元数据 + content，不再三份冗余）
    { agentId:"A", role:"assistant", content:"...", ts:123,
      tokens:{prompt:0,completion:0}, truncated:false }
  ],
  // 每个 AI 独立的上下文记忆（核心，物理隔离）
  memory: {
    "A": {
      messages: [ /* A 视角的 messages：自己是 assistant，对方是 user */ ],
      summary: "",            // 当前摘要（第一人称视角）
      lastSummarizedRound: 0  // 上次摘要到第几 round
    },
    "B": { messages:[], summary:"", lastSummarizedRound:0 }
  },
  stats: {                 // 修订：累计统计
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    estCost: 0             // 估算成本（美元）
  },
  error: null,             // status=error 时存错误信息
  createdAt: 123,
  updatedAt: 123
}
```

**关键设计：两个 AI 的 messages 各自如何构造？**
- 对于 AI-A：它眼中「对方(B)说的话」是 `role:"user"`，自己说的话是 `role:"assistant"`。
- 对于 AI-B：同理，A 的话是 `user`，自己的是 `assistant`。
- 因此 `memory.A.messages` 与 `memory.B.messages` 是**两条独立的 role 翻转数组**，绝不共享。
- **首条消息处理**：A 首次发言前，向 A 的 messages 注入一条「开场 user 提示」：
  ```
  现在请就话题「{{topic}}」开始对话。你是 {{A.name}}（{{A.persona}}），
  你的对话对象是 {{B.name}}。请用一段话发表你的开场观点（约 100-200 字）。
  ```
  这条提示只进 A 的 messages（作为 user），不进 B 的。
- **对方消息前缀**：A 发言完后，把 A 的 content 作为 user 写进 B 的 messages 时，
  统一加前缀 `[{{A.name}}]: `，避免 B 误以为自言自语。
  ```
  { role:"user", content:"[支持者]: 我认为应该立法，因为..." }
  ```
- **content-only 契约**：拼装对方 user 消息时**只取 message.content**，
  `reasoning_content` 一律丢弃。

### 5.2 双 AI 调度循环（WebSocket）

```
客户端 WS 发 { type:"start", sessionId }
  → 服务端校验：仅 status ∈ {idle, stopped, finished, error} 才能 start
  → 设 status=running, startedAt=now, 重置 stats（如新建）
  → 进入循环：
     1. 检查停止条件（顶部）：
        - status === "stopped" → break（reason="stopped"）
        - round >= maxRounds（若配置）→ break（reason="max_rounds"）
        - round >= ABSOLUTE_MAX_ROUNDS → break（reason="absolute_limit"）
        - now - startedAt >= durationSec（若配置）→ break（reason="duration"）
        - now - startedAt >= ABSOLUTE_MAX_DURATION_SEC → break（reason="absolute_limit"）
     2. currentAgentId = 轮到的那个（A、B 交替；A 先）
     3. 若到摘要触发点（round - lastSummarizedRound >= summaryEveryN
        或 token 阈值达 75%）：
        - 推 {type:"summary", agentId, phase:"start"}
        - 调用 summarizer 生成新摘要（温度 0.3，计入 stats）
        - 用摘要 + 滑动窗口重建该 AI 的 messages（保留最近 keepRecent 条）
        - 更新 memory[agentId].summary / lastSummarizedRound
        - 推 {type:"summary", agentId, phase:"done", summary}
     4. 组装 currentAgent 的 messages：
        [system(persona+规则)] [system(摘要)] [开场/历史 messages...]
     5. 创建 AbortController，存入 session 以便 stop 时 abort
     6. 调 DeepSeek 流式 API（套 30s 超时）：
        - 收到 content chunk → 累积 + 推 {type:"chunk", agentId, content}
        - 收到 reasoning_content chunk → 仅后端日志，不推前端
        - try/catch 包裹：流式中断 → 已收 chunk 拼为 truncated 消息落盘
          + 推 {type:"error", message} + 设 status=error + break
     7. 流结束（[DONE]）后：
        - 拿到完整 content + usage
        - 写入 session.messages（展示流，含 tokens）
        - 写入 memory[currentAgentId].messages（自己视角：assistant）
        - 写入 memory[对方].messages（对方视角：user，加前缀，content-only）
        - 累加 stats.totalTokens / estCost
        - messageCount++，落盘（同步写文件）
        - 推 {type:"message_done", agentId, message}
        - 推 {type:"stats", ...stats}
     8. currentAgentId 切换；若 messageCount 为偶数则 round++
     9. 推 {type:"turn_end", round, messageCount}
     10. 回到步骤 1
  → 循环退出后：设 status=finished（或保持 stopped/error），finishedReason=reason
  → flush 落盘
  → 推 {type:"finished", reason}
```

**容错与并发**：
- 每次 fetch 套 `AbortController` + 30s 超时。
- 用户 stop → 立即 `abortController.abort()` 当前 fetch，不等流结束。
- 同 session 重复 start：拒绝并推 error。
- WS 连接断开：循环不依赖 WS，继续跑；新 WS 连接上来时推 `{type:"sync", session}` 全量同步。

### 5.3 摘要 Prompt 模板（第一人称视角，修订）

**生成摘要 prompt**（作为独立 API 调用，user 角色，温度 0.3）：
```
下面是 {{agentName}} 参与的一段与 {{otherName}} 的对话。
请改以 {{agentName}} 的第一人称视角重写一份摘要，仿佛这份摘要就是 {{agentName}} 自己的备忘日记，供它后续继续对话时回忆使用。

要求：
1. 用「我」指代 {{agentName}}，用「对方({{otherName}})」指代另一位。
2. 重点记录：当前讨论的话题、我的核心立场与论点、对方的核心立场与论点、
   我们已达成或未达成的共识、尚未解决的问题。
3. 如果已有旧摘要，请【保留旧摘要中的关键事实原句，不要改写已有的事实陈述，只追加新事实】。
4. 控制在 {{words}} 字以内。只输出摘要正文，不要任何额外说明。

[旧摘要]
{{oldSummary or "（无）"}}

[最新对话]
{{recentMessages}}
```

**注入回上下文**（system 角色，放在 persona system 之后、对话之前）：
```
[对话进展摘要（你的视角）]
{{summary}}
```

### 5.4 API 设计

**REST**
| Method | Path | 说明 |
|---|---|---|
| POST | `/api/sessions` | 创建会话（body: topic, agents, config）|
| GET | `/api/sessions/:id` | 读取会话详情 |
| GET | `/api/sessions` | 列表 |
| DELETE | `/api/sessions/:id` | 删除 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/config/limits` | 返回全局熔断阈值（供前端展示）|

**WebSocket** `/ws/chat?sessionId=xxx`
- C→S：`{type:"start"} | {type:"stop"} | {type:"ping"}`
- S→C：
  - `{type:"sync", session}` 连接/重连时全量同步
  - `{type:"started"}`
  - `{type:"chunk", agentId, content}` 流式片段（仅 content）
  - `{type:"message_done", agentId, message}`
  - `{type:"summary", agentId, phase:"start"|"done", summary?}`
  - `{type:"turn_end", round, messageCount}`
  - `{type:"stats", totalTokens, estCost, ...}`
  - `{type:"error", message}`
  - `{type:"finished", reason}`
  - `{type:"pong"}`

### 5.5 前端页面

**布局**（单页）：
- 顶部状态栏：状态指示 + 当前 round / messageCount + **累计 token 与估算成本**（修订）+ 剩余轮数/时间。
- 左侧设置区（可折叠）：
  - 话题输入框
  - Agent A：名称 + 身份设定（textarea）
  - Agent B：名称 + 身份设定（textarea）
  - 模型选择（默认 flash）、温度（默认 0.7）
  - 对话轮数（留空=无限）、持续时间（留空=无限）
  - 摘要频率、保留消息数（高级，默认值）
  - **「无限对话会产生持续 API 费用」醒目提示**（修订）
  - 「开始」「停止」「重置」按钮
- 主区：消息流（气泡左右区分 A/B），流式打字效果；摘要触发时显示「{{name}} 正在整理记忆…」。
- 底部：事件/日志栏（摘要、轮次、错误、token 累计）。

**实时**：WS 连接，收到 chunk 追加到当前气泡；断线自动重连并接收 sync。

### 5.6 部署（修订：单端口方案）

**本地开发**
```bash
npm install
npm run dev
```
- 采用**单端口方案**：dev 模式下 Fastify (默认 3000) 通过 vite dev middleware
  挂载前端，用户**只访问 `http://localhost:3000`**，零跨端口代理。
- 启动后终端打印：`>>> 本地访问: http://localhost:<port>`。
- 自动打开浏览器：探测 `open`（macOS）/ `xdg-open`（Linux）/ `start`（Windows），
  探测失败只打印 URL 不报错。
- `PORT=0` 自动分配可用端口并打印实际端口。

**生产/远程**
```bash
npm run build   # vite build -> server/public
npm start       # node server/src/index.js, @fastify/static 托管 + SPA fallback
```
- 单一 Node 进程托管前端静态资源 + API + WS。
- 启动时 **fail-fast 校验** `DEEPSEEK_API_KEY`（缺失直接退出报错）。
- 远程反向代理到 80/443。

### 5.7 持久化策略（新章节）

- **每条 message_done 后同步落盘**（写整个会话 JSON；对话节奏是几秒一条，IO 无压力）。
- **graceful shutdown**：监听 SIGINT/SIGTERM，把所有 `status==="running"` 的会话
  改为 `stopped` 并 flush 后再退出。
- **启动恢复**：进程启动时扫描 `data/sessions/*.json`，
  把 `status==="running"` 的全部改为 `stopped`（崩溃恢复），避免重启后僵尸会话。
- v1 不做并发写锁（单进程内存态，无并发）。

### 5.8 熔断与成本（新章节）

- **全局硬熔断**（env 可配，默认值）：
  - `ABSOLUTE_MAX_ROUNDS=200`
  - `ABSOLUTE_MAX_DURATION_SEC=7200`（2 小时）
  - 即使 config 设了无限，也按这两个值兜底。
- **成本展示**：每轮结束推 `{type:"stats", totalTokens, estCost}`。
  - `estCost` 用 DeepSeek 公开价目估算（v4-flash 输入/输出单价），仅作参考。
  - 前端顶部常驻显示。
- **无限模式警告**：设置区 + README 醒目提示。

## 6. 实施步骤（里程碑）

| # | 里程碑 | 产出 | 验收 |
|---|---|---|---|
| M0 | 仓库初始化 | workspaces package.json、.gitignore、.env.example、目录骨架 | `npm install` 通过 |
| M1 | 后端骨架 | Fastify + WS + 健康检查 + fail-fast 校验 + 静态托管 | `curl /api/health` 200；缺 KEY 时退出 |
| M2 | DeepSeek 客户端 | `ai/deepseek.js` 流式调用 + AbortController + 30s 超时 | 命令行跑通一轮流式（仅取 content）|
| M3 | 会话存储 | sessionStore JSON 同步落盘 + 启动恢复 + REST CRUD | curl 创建/读取；重启后 running→stopped |
| M4 | 上下文 + 摘要 | `memory/context.js` + `summarizer.js`（第一人称）| 单测覆盖压缩、role 翻转、content-only |
| M5 | 双 AI 调度 | `ws/chatHandler.js` 完整循环 + 停止/容错 | WS 客户端脚本跑通 5 round |
| M6 | 前端页面 | 设置区 + 消息流 + WS + stats 显示 | 浏览器能跑完整对话 |
| M7 | 停止/限额/熔断 | 轮数、时长、停止、绝对熔断、成本展示 | 三种结束条件 + 熔断生效 |
| M8 | 部署打磨 | README、build/start、自动打开浏览器、graceful shutdown | 本地一键起、远程可部署 |

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 双 AI 陷入复读/漂移 | 摘要强制记录话题+立场；system prompt 要求「发现循环/重复对方刚说的话时主动转换角度、推进话题」|
| 流式中断/网络断开 | 已收 chunk 拼为 truncated 消息落盘 + 推 error + 跳出循环；WS 重连走 sync |
| DeepSeek 限流/超时 | 指数退避重试 3 次（仅非流式预热调用）；失败推 error |
| 无限对话烧钱 | 全局硬熔断 + 实时 token/cost 展示 + 设置区警告 |
| 进程崩溃丢数据 | 同步落盘 + graceful shutdown + 启动恢复 |
| API Key 泄露 | 前端永不直连 DeepSeek；Key 仅后端 .env |

## 8. 验收清单（Definition of Done）

- [ ] 输入话题+两个身份，点开始，两个 AI 自动轮流对话。
- [ ] 流式输出，前端逐字显示（仅 content，不含思维链）。
- [ ] 设置「轮数」能准确停在该 round；设置「时长」能到点停。
- [ ] 不设置则持续对话，点「停止」立即停止（abort 当前流）。
- [ ] 超过阈值自动触发摘要，前端有「正在整理记忆」提示，对话不中断、不崩。
- [ ] **触发摘要后下次调用 messages 中有 `[对话进展摘要]` 注入，且消息条数从 N 降到 keepRecent。**
- [ ] **对话进行到 30 round 后，A 的 messages 数组不含 B 的 system prompt；A 的摘要不含 B 的 persona 原文。**
- [ ] 两个 AI 的 system prompt 与记忆完全隔离，身份不串。
- [ ] **关浏览器重开，历史对话仍在；崩溃重启后 running 状态自动恢复为 stopped。**
- [ ] **API Key 错误 / 网络断开 / 达到限额时，前端有清晰错误提示，不卡死。**
- [ ] **顶部常驻显示累计 token 与估算成本。**
- [ ] `npm run dev` 本地起服务（单端口）并打开浏览器；`npm run build && npm start` 单进程可部署。
- [ ] API Key 通过 `.env` 注入，不入库 git；缺失时 fail-fast 退出。

## 9. 不在 v1 范围内

- 向量检索 RAG（v2）
- 多用户/账号系统
- 对话导出（v1 仅文件持久化，可在 v1.1 加）
- 可视化 token 消耗图表（v1 仅数字展示）
- 多模型（除 DeepSeek 外）

---
本文档经子智能体审核并修订完成（详见 REVIEW.md），状态 APPROVED_WITH_MINOR_ISSUES，进入实施。
