# Duet ♪ 双 AI 自主对话聊天室

> 给两个 AI 一个话题与身份，让它们自己聊起来。
> 支持轮数/时长上限、无限对话手动停止、长对话自动压缩记忆。
> 两个 AI 各自维护独立的上下文记忆，互不混淆身份。

![status](https://img.shields.io/badge/status-v2.0%20ready-green) ![model](https://img.shields.io/badge/model-deepseek--v4--flash-blue) ![stack](https://img.shields.io/badge/Vue-3.5%20%2B%20TS%20%2B%20Pinia-42b883) ![css](https://img.shields.io/badge/Tailwind-v4-38bdf8) ![pm](https://img.shields.io/badge/pnpm-workspace-f69220)

## ✨ 功能特性

- **一键启动双 AI 对话**：输入话题 + 两个智能体身份设定，点击开始即自动轮流对话。
- **流式输出**：逐字打字效果，实时看到 AI 的发言。
- **灵活的停止条件**：
  - 设置「对话轮数上限」按轮停止；
  - 设置「持续时间上限」到点停止；
  - 不设置则**无限对话**，随时点「停止」立即中断（中断当前流式请求）。
- **独立的长记忆**（参考 SillyTavern Summarize 机制）：
  - 两个 AI 各自维护独立的 messages 与 summary，物理隔离，身份不串；
  - 每 N 轮自动触发**第一人称视角摘要**压缩上下文；
  - 滑动窗口保留最近若干条原始消息。
- **成本可控**：顶部常驻显示累计 token 与估算成本；全局硬熔断兜底（默认 ≤ 200 轮 / 2 小时）。
- **持久化与崩溃恢复**：每条消息同步落盘，关闭浏览器重开历史仍在；进程崩溃重启后自动恢复。
- **双部署形态**：本地 CLI 一键起服务并打开浏览器；远程服务器单进程可部署。

## 🚀 快速开始

### 1. 安装依赖

项目使用 **pnpm** 管理（需先全局安装：`npm i -g pnpm`）：

```bash
pnpm install
```

### 2. 配置 API Key

复制环境变量模板并填入你的 DeepSeek API Key：

```bash
cp .env.example .env
# 编辑 .env，设置 DEEPSEEK_API_KEY=sk-xxxx
```

### 3. 本地开发启动

```bash
pnpm dev
```

启动后终端会打印访问地址（默认 `http://localhost:3000`），并**自动打开浏览器**。
在左侧填写话题和两个智能体的身份设定，点击「开始对话」即可。

### 4. 生产部署

```bash
pnpm build      # 构建前端到 server/public，并编译后端到 server/dist
pnpm start      # 启动单进程（托管前端 + API + WebSocket）
```

- 单一 Node 进程托管静态资源 + REST API + WebSocket。
- 通过 `PORT` 环境变量改端口（设为 `0` 自动分配可用端口）。
- 远程服务器反向代理到 80/443 即可对外服务。
- 推荐用 `pm2` 或 `systemd` 守护进程。

## 📖 使用说明

### 基本用法

1. **话题**：在「话题」输入框写你想让两个 AI 讨论的内容。
2. **智能体设定**：
   - 智能体 A：名称 + 身份设定（你是谁、你的立场是什么）。
   - 智能体 B：同上。
3. **开始**：点击「开始对话」，A 先发言，B 接力，自动循环。
4. **停止**：随时点「停止」立即中断（会保留已生成的部分消息）。
5. **重置**：清空当前界面，重新开始设置。

### 高级设置

| 参数 | 说明 | 默认值 |
|---|---|---|
| 模型 | DeepSeek 模型 | `deepseek-v4-flash` |
| 温度 | 生成多样性 | `0.7` |
| 对话轮数上限 | 留空=无限（仍受全局熔断） | 空（无限）|
| 持续时间上限(秒) | 留空=无限 | 空（无限）|
| 每 N 轮触发摘要 | 摘要压缩频率 | `10` |
| 压缩后保留最近消息数 | 滑动窗口大小 | `8` |

### 顶部状态栏

- 状态徽章：待机 / 对话中 / 已停止 / 已完成 / 错误
- 轮次：当前 round / 上限（∞ 表示无限）
- 时长：剩余时间或已运行时间
- **成本**：累计 token 数 + 估算美元成本

## 🏗️ 技术架构

| 层 | 选型 |
|---|---|
| 后端 | **TypeScript** + Node.js + **Fastify 5** + @fastify/websocket v11 + @fastify/static v10 |
| AI 调用 | 原生 fetch + SSE 流式解析（零 SDK 依赖）|
| 前端 | **Vue 3.5 + TypeScript + Pinia + Tailwind CSS v4** + Vite |
| 持久化 | JSON 文件（每条消息同步落盘，原子替换）|
| 包管理 | **pnpm workspace**（`server` + `web` 两个工作区）|

### 双 AI 独立记忆设计（核心）

每个 AI 维护**自己的视角**的 messages 数组：

```
AI-A 的视角：                 AI-B 的视角：
[system: A 的 persona+规则]   [system: B 的 persona+规则]
[system: 摘要（A视角）]        [system: 摘要（B视角）]
[user: 开场提示]               ...
[assistant: A的发言1]          [user: [A]: A的发言1]
[user: [B]: B的发言1]          [assistant: B的发言1]
[assistant: A的发言2]          [user: [A]: A的发言2]
...                            ...
```

- A 说的话，在 A 视角是 `assistant`，在 B 视角是 `user`（带 `[A名]:` 前缀）。
- 摘要各自生成，以**第一人称**撰写（"我"、"对方"），避免身份混淆。
- 对方的思维链（`reasoning_content`）绝不进入自己的上下文。

详见 `docs/DEVELOPMENT_PLAN.md`。

## 📁 项目结构

```
duet/
├── docs/                  # 文档（开发计划、调研笔记、审核记录）
├── server/                # 后端（Fastify 5 + WS + DeepSeek 客户端）
│   └── src/
│       ├── ai/            # DeepSeek 流式客户端 + prompt 模板
│       ├── memory/        # 上下文管理 + 摘要器
│       ├── store/         # 会话持久化
│       ├── ws/            # WebSocket 双 AI 调度
│       └── routes/        # REST 路由
├── web/                   # 前端（Vue 3 + TS + Pinia + Tailwind v4 + Vite）
│   └── src/
│       ├── assets/        # Tailwind 主题（@theme 设计 token）
│       ├── types/         # 后端 API 契约类型
│       ├── services/      # REST 封装 + localStorage 草稿
│       ├── composables/   # WebSocket 连接 + 计时器
│       ├── stores/        # Pinia（session / form / draft / config）
│       └── components/    # SFC 组件（Header/Bubble/Sidebar…）
├── pnpm-workspace.yaml    # pnpm 工作区配置
└── data/sessions/         # 运行时会话数据（gitignore）
```

## 🔧 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（必填）| - |
| `DEEPSEEK_BASE_URL` | API 地址 | `https://api.deepseek.com/v1` |
| `DEEPSEEK_MODEL` | 默认模型 | `deepseek-v4-flash` |
| `PORT` | 服务端口（0=自动）| `3000` |
| `ABSOLUTE_MAX_ROUNDS` | 全局最大轮数熔断 | `200` |
| `ABSOLUTE_MAX_DURATION_SEC` | 全局最大时长熔断(秒) | `7200` |
| `REQUEST_TIMEOUT_MS` | 单次 AI 调用超时(毫秒) | `30000` |
| `COST_INPUT_PER_MTOK` | 输入 token 单价($/百万) | `0.27` |
| `COST_OUTPUT_PER_MTOK` | 输出 token 单价($/百万) | `1.10` |

## ⚠️ 注意事项

- **无限对话会产生持续 API 费用**，请留意顶部 token 与成本统计，及时停止。
- 全局熔断默认 200 轮 / 2 小时，可通过环境变量调整。
- API Key 仅存在后端 `.env`，前端不直接调用 DeepSeek。
- 模型返回的 `reasoning_content`（思维链）仅用于后端调试，不会展示给前端，也不会进入对方 AI 的上下文。

## 📚 文档

- [开发计划](docs/DEVELOPMENT_PLAN.md) — 完整设计文档
- [调研笔记](docs/RESEARCH_NOTES.md) — DeepSeek API 实测数据
- [审核记录](docs/REVIEW.md) — 计划审核与修订记录

## 📜 License

MIT
