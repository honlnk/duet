# Duet ♪ 多智能体自主对话聊天室

> 给 2~10 个 AI 一个话题与各自的身份，让它们自己聊起来。
> 支持轮数/时长上限、无限对话手动停止、长对话自动压缩记忆。
> 每个 AI 各自维护独立的上下文记忆，互不混淆身份。

![status](https://img.shields.io/badge/status-v3.0%20ready-green) ![agents](https://img.shields.io/badge/agents-2~10-orange) ![provider](https://img.shields.io/badge/provider-OpenAI%20%7C%20Anthropic%20%7C%20Gemini-blue) ![stack](https://img.shields.io/badge/Vue-3.5%20%2B%20TS%20%2B%20Pinia-42b883) ![css](https://img.shields.io/badge/Tailwind-v4-38bdf8) ![pm](https://img.shields.io/badge/pnpm-workspace-f69220)

## ✨ 功能特性

- **一键启动多智能体对话**：输入话题 + 2~10 个智能体身份设定，点击开始即按 A→B→C→…→A 顺序自动轮流对话。
- **流式输出**：逐字打字效果，实时看到 AI 的发言。
- **多 Provider / 多协议模型管理**：
  - 支持 **OpenAI 兼容 / Responses / Anthropic / Gemini** 四种协议，每个智能体可各自绑定不同 Provider 与模型；
  - 在页面内可视化维护 API Key、模型、价格，按需「获取列表」拉取上游模型；
  - 单价 / 缓存命中 / 缓存写入分维度计费，支持 CNY/USD/EUR 并按在线汇率换算。
- **自定义颜色标识**：每个智能体可指定 6 种预设色（蓝/粉/绿/琥珀/紫/青）或任意 `#hex` 自定义色，气泡、头像、强调条自动着色，长对话中一眼区分发言者。
- **模板复用**：把常用的智能体设定（名字 + persona）和话题保存为模板，新建对话时一键套用，在「设置」页集中管理。
- **灵活的停止条件**：
  - 设置「对话轮数上限」按轮停止；
  - 设置「持续时间上限」到点停止；
  - 不设置则**无限对话**，随时点「停止」立即中断（中断当前流式请求）。
- **独立的长记忆**（参考 SillyTavern Summarize 机制）：
  - 每个智能体各自维护独立的 messages 与 summary，物理隔离，身份不串；
  - 每 N 轮自动触发**第一人称视角摘要**压缩上下文；
  - 滑动窗口保留最近若干条原始消息。
- **成本可控**：右侧详情面板显示累计 token 与估算成本；全局硬熔断兜底（默认 ≤ 200 轮 / 2 小时）。
- **持久化与崩溃恢复**：每条消息同步落盘，关闭浏览器重开历史仍在；进程崩溃重启后自动恢复。
- **多种部署形态**：源码本地运行、`npx` 一键启动、Docker 容器部署，任选其一。

## 🚀 快速开始

### 1. 安装依赖

项目使用 **pnpm** 管理（需先全局安装：`npm i -g pnpm`）：

```bash
pnpm install
```

### 2. 启动服务

```bash
pnpm dev
```

开发模式采用前后端分离：后端跑在 `http://localhost:3000`（仅提供 API/WebSocket），前端由 vite 独立托管在 `http://localhost:5174`（支持热更新）。
请用浏览器访问 **`http://localhost:5174`**。

> 开发模式下后端不会自动打开浏览器（前端由 vite 托管）。自动打开浏览器的行为仅在生产模式（`pnpm start`）下发生。

### 3. 配置 Provider（API Key / 模型）

启动后首次访问，页面会提示尚未配置 Provider。点击右上角「Provider」按钮打开管理面板，添加你的第一个 Provider：

- 选择**协议**：OpenAI 兼容（含 DeepSeek）/ Responses / Anthropic / Gemini；
- 填写 **API Key、Base URL、模型名**，可点「获取列表」从上游拉取可用模型；
- 可选填**价格**（输入 / 输出 / 缓存命中 / 缓存写入，支持 CNY/USD/EUR 并按在线汇率换算），留空则用内置兜底单价估算成本。

第一条 Provider 会自动成为默认。之后在「高级设置」里可给每个智能体各自绑定不同 Provider。配置落盘到 `data/providers.json`。

> API Key 仅存在后端，前端不直接调用任何模型 API。

### 4. 生产部署

提供三种生产部署形态，按需选择。各形态的环境变量均为**可选**（见下表），API Key / 模型 / 价格等凭证一律通过页面 Provider 面板维护。

#### 形态 A：源码部署（本地或服务器）

```bash
pnpm build      # 构建前端到 server/public，并编译后端到 server/dist
pnpm start      # 启动单进程（托管前端 + API + WebSocket）
```

- 单一 Node 进程托管静态资源 + REST API + WebSocket。
- 通过 `PORT` 环境变量改端口（设为 `0` 自动分配可用端口）。
- 远程服务器反向代理到 80/443 即可对外服务。
- 推荐用 `pm2` 或 `systemd` 守护进程。

#### 形态 B：npm 包（npx 一键启动，无需 clone 源码）

```bash
# 临时运行（自动拉取并启动，随后自动打开浏览器）
npx @honlnk/duet

# 或全局安装后使用
npm i -g @honlnk/duet
DATA_DIR=~/.duet duet-chat
```

- 包内已内置前端构建产物，开箱即用。
- 建议用 `DATA_DIR` 指定数据持久化目录（如 `~/.duet`），避免会话数据写到包目录。
- 启动后在页面 Provider 面板配置 API Key / 模型。其余配置通过环境变量传入（见 `.env.example`）。

#### 形态 C：Docker（容器化部署）

```bash
# 方式一：docker run
docker build -t duet .
docker run -d -p 3000:3000 \
  -v duet-data:/data \
  duet

# 方式二：docker compose（推荐，配置已写在 docker-compose.yml）
docker compose up -d --build
```

- 多阶段构建（alpine），运行镜像仅含编译产物 + 生产依赖，体积小。
- 会话数据与 `providers.json` 通过卷（`/data`）持久化，容器删除重建后仍在。
- 以非 root 用户运行，内置健康检查（`/api/health`）。
- 容器启动后，在页面 Provider 面板配置 API Key / 模型（无需在环境变量中传入）。

#### 配置项

环境变量均为**可选**（无必填项）。API Key / 模型 / 价格等凭证不在环境变量中配置，启动后通过页面 Provider 面板维护。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务端口（`0` = 自动分配） |
| `DATA_DIR` | `项目根/data/sessions` | 会话数据持久化目录（npm 包 / Docker 建议显式指定；`providers.json` 落盘到其父目录） |
| `ABSOLUTE_MAX_ROUNDS` | `200` | 全局硬熔断轮数 |
| `ABSOLUTE_MAX_DURATION_SEC` | `7200` | 全局硬熔断时长（秒） |
| `REQUEST_TIMEOUT_MS` | `30000` | 单次 AI 调用超时（毫秒） |

完整配置见 [`.env.example`](./.env.example)。

## 📖 使用说明

### 基本用法

1. **话题**：从「话题」下拉中选用一个话题模板（可在「设置」页提前维护）。
2. **智能体设定**：每个智能体从模板列表中选择身份设定（名字 + persona）。可添加 2~10 个，模板可在「设置」页集中管理。
3. **开始**：点击「开始对话」，A 先发言，B 接力，C 继续……自动循环回到 A。
4. **停止**：随时点「停止」立即中断（会保留已生成的部分消息）。
5. **重置**：清空当前界面，重新开始设置。

### 高级设置

| 参数 | 说明 | 默认值 |
|---|---|---|
| 每个智能体的 Provider | 分别绑定各智能体使用的 Provider | 默认 Provider |
| 温度 | 生成多样性 | `0.7` |
| 对话轮数上限 | 留空=无限（仍受全局熔断） | 空（无限）|
| 持续时间上限(秒) | 留空=无限 | 空（无限）|
| 每 N 轮触发摘要 | 摘要压缩频率 | `10` |
| 压缩后保留最近消息数 | 滑动窗口大小 | `8` |

> Provider（含 API Key、协议、模型、价格）在页面右上角「Provider」面板统一管理，详见上文「配置 Provider」。

### 模板管理

在「设置」页可维护两类模板：

- **智能体模板**：保存常用的名字 + persona，新建对话时一键填入，无需重复粘贴长设定。
- **话题模板**：保存常用讨论话题，下次直接选用。

模板存在浏览器 localStorage，随用随取。

### 右侧详情面板（Inspector）

会话详情页右侧的 Inspector 面板汇总本次对话的运行状态与统计，默认展开，可一键收起：

- 状态徽章：待机 / 对话中 / 已停止 / 已完成 / 错误
- 轮次：当前 round / 上限（∞ 表示无限）
- 时长：剩余时间或已运行时间
- **成本**：累计 token 数 + 估算成本（货币符号跟随默认 Provider 的币种：¥ / $ / 代码前缀）
- 各智能体信息：名称、颜色标识、绑定的 Provider
- 缓存命中率、合计字符数等细项

## 🏗️ 技术架构

| 层 | 选型 |
|---|---|
| 后端 | **TypeScript** + Node.js + **Fastify 5** + @fastify/websocket v11 + @fastify/static v10 |
| AI 调用 | 原生 fetch + SSE 流式解析（零 SDK 依赖），内建 OpenAI 兼容 / Responses / Anthropic / Gemini 多协议适配器（`ai/providers/`）|
| 前端 | **Vue 3.5 + TypeScript + Pinia + Tailwind CSS v4** + Vite |
| 持久化 | JSON 文件（每条消息同步落盘，原子替换）；Provider 凭证存 `providers.json` |
| 包管理 | **pnpm workspace**（`server` + `web` 两个工作区）|

### 多智能体独立记忆设计（核心）

每个智能体维护**自己视角**的 messages 数组，彼此物理隔离：

```
A 的视角：                 B 的视角：                 C 的视角：
[system: A 的 persona+规则]  [system: B 的 persona+规则]  [system: C 的 persona+规则]
[system: 摘要（A 视角）]     [system: 摘要（B 视角）]     [system: 摘要（C 视角）]
[assistant: A 的发言]        [user: [A]: A 的发言]        [user: [A]: A 的发言]
[user: [B]: B 的发言]        [assistant: B 的发言]        [user: [B]: B 的发言]
[user: [C]: C 的发言]        [user: [C]: C 的发言]        [assistant: C 的发言]
...                          ...                          ...
```

- 自己说的话在自己的视角是 `assistant`，在其他人的视角是 `user`（带 `[名字]:` 前缀）。
- 摘要各自生成，以**第一人称**撰写（"我"、"对方们"），避免身份混淆。
- 对方的思维链（`reasoning_content`）绝不进入自己的上下文。

### 轮次定义（N 智能体场景）

- **1 轮（round）= N 个智能体各发言一次 = N 条 message**（N = 智能体数量）。
- `round = floor(messageCount / agents.length)`。
- 「对话轮数上限」「摘要频率」均按 round 计。

## 📁 项目结构

```
duet/
├── docs/                  # 文档（开发计划、调研笔记、审核记录）
├── server/                # 后端（Fastify 5 + WS + 多协议 AI 客户端）
│   └── src/
│       ├── ai/            # 多协议流式适配器 + prompt 模板
│       │   └── providers/ # openai / openai-responses / anthropic / gemini
│       ├── memory/        # 上下文管理 + 摘要器（第一人称视角）
│       ├── store/         # 会话 + Provider 凭证持久化
│       ├── ws/            # WebSocket 多智能体调度
│       ├── routes/        # REST 路由
│       ├── types/         # 后端类型定义
│       └── utils/         # 成本计算等工具
├── web/                   # 前端（Vue 3 + TS + Pinia + Tailwind v4 + Vite）
│   └── src/
│       ├── assets/        # Tailwind 主题（@theme 设计 token）
│       ├── types/         # 后端 API 契约类型
│       ├── services/      # REST 封装 + localStorage 草稿与模板
│       ├── composables/   # WebSocket 连接 + 计时器 + 响应式逻辑
│       ├── stores/        # Pinia（session / sessions / form / draft / config / provider / template）
│       ├── utils/         # 智能体颜色映射（agentColor）
│       ├── router/        # Vue Router 路由
│       ├── views/         # 页面（Home / Session）
│       └── components/    # SFC 组件（Sidebar / Bubble / Inspector / Modal…）
├── pnpm-workspace.yaml    # pnpm 工作区配置
└── data/sessions/         # 运行时会话数据（gitignore）
```

## 🔧 环境变量

环境变量均为**可选**，用于调整服务端口、数据目录与全局熔断参数。模型凭证（API Key、Base URL、模型、价格）不再通过环境变量配置，统一在页面「Provider」面板维护。

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 服务端口（0=自动）| `3000` |
| `DATA_DIR` | 会话数据持久化目录（`providers.json` 落盘到其父目录）| `项目根/data/sessions` |
| `ABSOLUTE_MAX_ROUNDS` | 全局最大轮数熔断 | `200` |
| `ABSOLUTE_MAX_DURATION_SEC` | 全局最大时长熔断(秒) | `7200` |
| `REQUEST_TIMEOUT_MS` | 单次 AI 调用超时(毫秒) | `30000` |
| `NODE_ENV` | 运行环境（production / development）| 自动推断 |

## ⚠️ 注意事项

- **无限对话会产生持续 API 费用**，请留意右侧详情面板的 token 与成本统计，及时停止。
- 全局熔断默认 200 轮 / 2 小时，可通过环境变量调整。
- API Key 仅存在后端（落盘到 `providers.json`），前端不直接调用任何模型 API。
- 模型返回的 `reasoning_content`（思维链）仅用于后端调试，不会展示给前端，也不会进入其他智能体的上下文。

## 📚 文档

- [门户页](https://duet.honlnk.com/) — 项目介绍与快速开始（`site/`，由 GitHub Actions 自动发布）
- [开发计划](docs/DEVELOPMENT_PLAN.md) — 初始设计文档（v1，部分已演进，见文首声明）
- [调研笔记](docs/RESEARCH_NOTES.md) — DeepSeek API 实测数据
- [审核记录](docs/REVIEW.md) — 计划审核与修订记录

## 📜 License

MIT
