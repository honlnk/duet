# 开发计划：导演 Agent Loop + 资产库服务端化

> 状态：**待定稿**（依据 2026-09-28 需求讨论成文，等待用户确认后按 Wave 开工）
> 创建：2026-09-28

---

## 一、背景与目标

Duet 当前只有一个「固定策略的自主对话循环」（`server/src/ws/chatHandler.ts` 的 `runLoop`：轮转调 LLM、写角色记忆，模型只产文本，无工具无动作空间）。本项目将其升级为**双 loop 架构**：

- **Loop 1 对话循环**：现有 `runLoop`，聊天室用，**原封不动**。
- **Loop 2 Agent 循环**：新增一个真正的 tool-use agent loop（参考同级目录 NovAI 项目的分层实现，取简化子集），让用户在聊天界面里指挥 Agent 对资产数据做增删改查。

本期 Agent 只做一件事：**对角色模板、话题模板、世界观模板、角色关系四类资产数据做增删改查**。

前置工程：这四类资产现在全存在浏览器 localStorage，而 Agent 循环必须跑在服务端（API key 只存后端 `data/providers.json` 的既定设计）。因此本期顺带完成**资产数据服务端化**：放弃 localStorage 存资产，改为服务端本地文件存储。

---

## 二、已拍板决策记录（与用户对话确认，施工方不得更改）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | Agent 循环运行位置 | 服务端。API key 永不进前端（既定设计） |
| 2 | UI 形态 | 右下角机器人头像悬浮按钮 → 点开弹框聊天；工具调用在聊天流中以折叠行显示；移动端全屏化 |
| 3 | 模型选择 | 输入框内直接选 Provider+模型 与 思考强度，选项来自现有设置里的 Provider 列表，**不单独配置** |
| 4 | 写确认 | v1 不做逐条确认；删除类操作在气泡中明示，靠「再聊一句让 Agent 加回来」兜底 |
| 5 | 聊天历史 | 不持久化，刷新页面即新会话（资产数据本身在服务端，不丢） |
| 6 | 资产数据去向 | 全部迁服务端本地文件；草稿、历史预设、汇率缓存**留在 localStorage** |
| 7 | 关系图节点坐标 | 随关系一起迁服务端 |
| 8 | 工具的作用对象 | 只调服务端内存 store 函数，**绝不直接读写文件系统**（与 NovAI 文件工具的本质区别） |
| 9 | 参考实现 | NovAI（`/Users/honlnk/project/NovAI/packages/core/src/core/agent/`），取 query/tools/tool-execution 分层的简化子集 |
| 10 | 迁移原则 | 模板 id 原样保留（草稿/历史/关系的引用链不断）；localStorage 旧 key 保留作备份不删除 |

---

## 三、技术方案（本文档直接定案，不留开放选择题）

### 3.1 服务端资产库存储

- **单文件** `data/library.json`，与 `providers.json` 平级、同模式（启动加载进内存、变更即落盘、tmp+rename 原子写）。
- 结构：

```json
{
  "characterTemplates": [{ "id": "ct_...", "name": "", "description": "", "personality": "", "createdAt": 0 }],
  "topicTemplates": [{ "id": "tt_...", "content": "", "createdAt": 0 }],
  "worldviewTemplates": [{ "id": "wt_...", "name": "", "scenario": "", "createdAt": 0 }],
  "relationships": { "{fromTemplateId}->{toTemplateId}": "描述" },
  "nodePositions": { "{templateId}": { "x": 0, "y": 0 } }
}
```

- 字段与现有 localStorage 中的 `CharacterTemplate / TopicTemplate / WorldviewTemplate` 接口**完全一致**（见 `web/src/services/templates.ts`、`web/src/services/relationships.ts`），不发明新字段。
- 代码位置：`server/src/store/libraryStore.ts`（单进程内存权威 + 写盘，与 `sessionStore` 同套路）。Agent 工具与 REST 路由共用这一个 store 模块。

### 3.2 REST API（给前端用）

```
GET    /api/templates/characters          列出
POST   /api/templates/characters          新建（body = 模板字段，id 服务端生成）
PUT    /api/templates/characters/:id      整体更新
DELETE /api/templates/characters/:id      删除
（topics、worldviews 两组完全同构）
GET    /api/relationships                 { relationships, nodePositions }
PUT    /api/relationships                 整体覆盖（关系图画布批量保存用）
POST   /api/library/import                一次性迁移导入（按 id upsert，幂等）
```

### 3.3 前端切换与一次性迁移

- `web/src/services/templates.ts`、`web/src/services/relationships.ts` 的函数签名保持同名导出，实现从 localStorage 换成 REST 调用（**签名变 async**）。
- `stores/template.ts`、`stores/relationship.ts` 及设置弹窗（`SettingsModal.vue`）、关系画布（`RelationshipCanvas.vue`）的调用点适配 `await`；UI 布局不动。
- **一次性迁移**：应用启动时判断「服务端库为空 && localStorage 存在旧数据」→ 读出四类数据 + 节点坐标 → `POST /api/library/import` → 成功后写标记 key `duet:library-migrated:v1`。旧数据 key **保留不删**（备份）。导入按 id upsert，半途失败下次启动自动重试（幂等）。
- 旧的 `duet:agent-templates:v1`（智能体时期 legacy key）迁移逻辑删除——由服务端迁移统一接管。

### 3.4 适配器层补 tools 支持（移植 NovAI）

现状：`server/src/ai/providers/`（openai / openai-responses / anthropic / gemini）零 tool 支持。改动：

- `chatCompletion` 入参新增 `tools`（OpenAI function-calling 格式的 schema 数组）与 `toolChoice`。
- 各协议实现：请求侧 tools 线格式转换；响应侧 `tool_calls`（或 anthropic `tool_use` / gemini `functionCall`）解析为统一的 `AgentToolCall[]`；**流式 delta 组装**（含 arguments 分片拼接、坏块丢弃）。
- 移植来源对照：

| NovAI 文件 | 用途 |
|---|---|
| `core/llm/protocol/openai-chat.ts` | 流式 tool_calls 组装 + 非流式解析 + 降级 |
| `core/llm/protocol/anthropic.ts` / `gemini.ts` / `openai-responses.ts` | 各协议线格式转换 |
| `core/agent/messages.ts` 的 `AgentToolCall` | 统一工具调用结构 |

### 3.5 Agent 循环核心（新模块 `server/src/agent/`）

分层照抄 NovAI、按本期范围裁剪：

| 文件 | 职责 | 相对 NovAI 的裁剪 |
|---|---|---|
| `messages.ts` | `AgentMessage`（system / user / assistant{toolCalls} / tool{toolCallId}）、`AgentToolSchema` | 保留（去掉 reasoning/thoughtSignature 协议兼容字段，Duet 适配器已有思考档位处理） |
| `tools.ts` | 工具表：schema + validateInput + run + summarize + formatResult | 全新实现（业务工具，非文件工具） |
| `tool-execution.ts` | 单个工具执行：未知工具兜底回灌 → 参数校验失败回灌 → 执行 → 结果文本化 | 去掉写确认、spill、改动账本 |
| `query.ts` | 主循环：`while(true)` 每 step「LLM 流式 → append assistant → 有 toolCalls 则逐个执行回灌 → 无则收尾」 | 去掉压缩、steering、溢出重试；保留 AbortController 与 maxTurns 安全阀（**定为 30**） |
| `prompt.ts` | 系统提示词：编排助手人设 + 工作原则（先查再改 / 删除前口头复述 / 改动后总结）+ 工具使用规则 | 新写 |

- **会话态**：内存 `Map<sessionId, AgentMessage[]>`，空闲 2 小时清理；sessionId 由前端生成（sessionStorage 级，刷新即换新——与决策 #5 一致）。
- **工具清单（12 个，snake_case 命名，写操作用 upsert 语义）**：

| 工具 | 参数 | 说明 |
|---|---|---|
| `list_character_templates` | — | 列出全部角色模板 |
| `upsert_character_template` | `id?` `name` `description` `personality` | id 空=新建，非空=更新 |
| `delete_character_template` | `id` | 删除 |
| `list_topic_templates` | — | 列出全部话题模板 |
| `upsert_topic_template` | `id?` `content` | 同 upsert 语义 |
| `delete_topic_template` | `id` | 删除 |
| `list_worldview_templates` | — | 列出全部世界观模板 |
| `upsert_worldview_template` | `id?` `name` `scenario` | 同 upsert 语义 |
| `delete_worldview_template` | `id` | 删除 |
| `list_relationships` | — | 列出全部关系（含两端模板名） |
| `set_relationship` | `fromTemplateId` `toTemplateId` `description` | 设置一条有向关系 |
| `delete_relationship` | `fromTemplateId` `toTemplateId` | 删除一条有向关系 |

- **LLM 调用失败**：v1 不自动重试，错误作为 error 事件 surfaced 到聊天界面（与聊天室的指数退避不同，Agent 场景用户可自行重发）。

### 3.6 SSE 端点（Agent 聊天通道）

- `POST /api/agent/chat`，body：`{ sessionId, text, providerId, model, thinking? }`。
- SSE 事件流：`delta`（正文增量）/ `tool_call` / `tool_result`（含改动摘要，前端据此刷新资产 store）/ `done` / `error`。
- 客户端断开连接 = AbortController abort，循环优雅退出。
- **选 SSE 不选 WS 的理由**：请求作用域、天然 abort、无连接态管理；Duet 现有 WS 是按会话房间广播的模型，不适合一问一答的 Agent 聊天。
- 注意代理缓冲：响应头加 `X-Accel-Buffering: no`，用 chunked 写法。

### 3.7 前端挂件

- `web/src/components/AgentWidget.vue`，在 `App.vue` 全局挂载（首页与会话页均可见）。
- 右下角悬浮按钮 → 弹框：消息流（用户/助手气泡 + 工具调用折叠行，点开看改动详情）+ 输入区（textarea + Provider/模型下拉 + 思考强度下拉 + 发送/停止按钮）。
- 下拉选项来源：现有 Provider store（与设置页同一数据源）；思考强度选项用服务端已有的 thinking-options 逻辑。
- 收到 `tool_result` 事件后重新拉取模板/关系 store → 背后页面（设置弹窗、关系画布）数据联动刷新。
- 移动端弹框全屏（复用设置弹窗刚做过的适配模式）；空态显示一句问候 + 可直接点的示例指令。

---

## 四、施工分期（Wave）与验收

> 门禁纪律：每 Wave 收尾必须「测试全绿 + `pnpm typecheck` 干净 + 本文档状态流转与施工日志落盘」，否则不开下一 Wave。

### Wave 1：资产库服务端化 + 前端切换 + 迁移

- 范围：`libraryStore` + 全部 REST 路由 + 前端两个 service 换 REST + Pinia store 适配 + 一次性迁移逻辑。
- 验收：
  - 单测：store 增删改查 / REST 路由往返 / import 幂等（同数据导两次不重复）/ import 保 id。
  - 手动：设置弹窗三个模板 tab 增删改正常；带旧 localStorage 数据的浏览器首启自动迁移成功，旧 key 仍在；刷新后数据从服务端来。

### Wave 2：适配器 tools 支持

- 范围：四协议 `chatCompletion` 支持 tools 入参与 tool_calls 解析（流式 + 非流式）。
- 验收：每协议单测——构造流式 chunk 序列断言 toolCalls 组装正确（含 arguments 分片、异常块丢弃）；非流式响应解析正确；不传 tools 时行为与现状完全一致（回归）。

### Wave 3：Agent 循环核心 + SSE 端点

- 范围：`server/src/agent/` 五个文件 + `/api/agent/chat` SSE。
- 验收：
  - 单测（fake adapter 脚本化）：第一轮返回 tool_calls → 工具真执行且写进 libraryStore → tool 结果回灌 → 第二轮纯文本收尾；未知工具回灌不崩溃；参数校验失败回灌；maxTurns 触发优雅收尾；abort 中断路径。
  - 手动：curl SSE 流可见事件序列。

### Wave 4：前端挂件

- 范围：`AgentWidget.vue` + 全局挂载 + 选择器 + 工具行渲染 + 资产联动刷新 + 移动端。
- 验收（手动 E2E 清单）：打开弹框 → 输入「帮我建一个角色：xxx」→ 看到工具折叠行 → 打开设置弹窗核对角色已出现 → 让 Agent 改性格 → 核对更新 → 让 Agent 删除 → 核对消失 → 手机宽度全屏正常。

### Wave 5：收尾

- README.md 增加双 loop 架构与 Agent 助手功能段；本文档状态流转收尾；全量回归（server 全部测试 + `pnpm typecheck` + web `pnpm build`）。

---

## 五、迁移条款（汇总）

| 旧数据 | 去向 |
|---|---|
| `duet:character-templates:v1` / `duet:topic-templates:v1` / `duet:worldview-templates:v1` / `duet:relationships:v1` / `duet:node-positions:v1` | 一次性导入 `data/library.json`，id 原样保留；本地 key 保留作备份，不再写入 |
| `duet:agent-templates:v1`（更早的 legacy） | 其迁移逻辑随 localStorage 实现一起删除；若用户浏览器里还有该 key，迁移读取时顺带兼容（与现逻辑一致） |
| `duet:draft:v2` / `duet:history:v2` / `duet:exchange-rates` | 不迁移，留在 localStorage（草稿/历史中的 templateId 因 id 保留而不断链） |

---

## 六、新旧机制替代表

| 旧机制 | 去向 |
|---|---|
| `services/templates.ts` 的 localStorage 读写 | **替换**为 REST 实现（同名导出，签名 async） |
| `services/relationships.ts` 的 localStorage 读写 | 同上 |
| localStorage 资产 key 写入路径 | **删除**（key 本身保留只读备份） |
| `runLoop`（聊天室对话循环） | **不动**（本次改造零接触） |

---

## 七、明确不做（本期排除的诱惑项）

- 上下文压缩（compaction）、超长结果 spill、子代理委派、steering 插话——NovAI 有，本期全不要。
- 逐条写确认弹窗。
- Agent 聊天历史持久化。
- 会话内数据的 Agent CRUD（导演指令、会话 relationships、开场设定）——工具只碰资产库。
- 关系描述自动生成（REQUIREMENTS_CHARACTER_SYSTEM.md §4.5.1 的预处理设想）。
- site/ 门户页、i18n、Agent 对资产库以外任何数据的访问。
- LLM 调用自动重试。

---

## 八、风险与对策

| 风险 | 对策 |
|---|---|
| 四协议 tool_calls 线格式差异大 | 直接移植 NovAI 已淬炼的实现，逐协议单测兜底 |
| localStorage 迁移半途失败 | import 幂等（id upsert），下次启动自动重试 |
| Agent 工具与 REST 并发写 library.json | 单进程内存串行 + 落盘同 providers.json 现状，无多进程场景 |
| 所选模型不支持 function calling | 无法自动探测；README 与输入框空态文案注明需选支持工具调用的模型；协议报错时 error 事件原样 surfaced |
| SSE 被代理缓冲 | `X-Accel-Buffering: no` + chunked 写法；本地开发无代理不受影响 |
| Agent 上下文无限增长（无压缩） | maxTurns=30 安全阀 + 会话刷新即重置；资产库不大，工具结果可控 |

---

## 九、文档同步计划

- 本文档承载状态流转（下节）与施工日志（日期 + Wave + 验收结论 + 偏差记录），每 Wave 门禁时落盘。
- README.md 在 Wave 5 更新功能描述。
- 施工中发现的计划外问题记入施工日志，不随手改计划。

---

## 十、状态索引

| Wave | 内容 | 状态 |
|---|---|---|
| 1 | 资产库服务端化 + REST + 前端切换 + 迁移 | ✅ 已完成（2026-09-28） |
| 2 | 适配器 tools 支持（四协议） | ✅ 已完成（2026-09-28） |
| 3 | Agent 循环核心 + SSE 端点 | ✅ 已完成（2026-09-28） |
| 4 | 前端挂件（弹框聊天 + 选择器 + 联动刷新） | ✅ 已完成（2026-09-28，浏览器端人工复核待用户） |
| 5 | README + 回归 + 收尾 | ✅ 已完成（2026-09-28） |

---

## 十一、施工日志

### 2026-09-28 Wave 1：资产库服务端化 ✅

**产出**
- 新增 `server/src/store/libraryStore.ts`（内存权威 + tmp/rename 原子落盘，对齐 providerStore 模式）
- 新增 `server/src/routes/library.ts`（模板三组 CRUD + GET/PUT /api/relationships + GET /api/library/status + POST /api/library/import），注册进 index.ts
- `types/index.ts` 新增 Library 类型族；`config.ts` 新增 `libraryFile` 路径（DATA_DIR 同级，与 providers.json 平级）
- 前端重写：`services/templates.ts` / `services/relationships.ts` 从 localStorage 换为 REST（全 async）；`stores/template.ts` / `stores/relationship.ts` 改为 async 变更 + 本地即时更新 + 失败刷新兜底；`stores/form.ts` 的 payload computed 改读 relationshipStore 缓存（原同步读 localStorage，computed 无法 await）；`App.vue` 启动时先迁移后刷新
- 新增 `web/src/services/libraryMigration.ts`：标记 key `duet:library-migrated:v1` + 「服务端非空则不覆盖」+ 幂等导入；旧 localStorage key 保留只读
- 新增 `server/src/library.test.ts`（14 个用例）

**验收结论**
- server：`pnpm test` 63/63 绿（含新增 14）；`pnpm typecheck` 干净
- web：`pnpm type-check` 干净；`pnpm build` 成功
- 冒烟：起真实进程 curl 验证 status → 角色模板 POST/GET → import → relationships 读写 → data/library.json 落盘内容正确
- 未做浏览器端手动 E2E（需要用户真人复核：设置弹窗三 tab 操作、带旧 localStorage 数据的浏览器首启迁移）→ 已列入交付汇报的未验证清单

**偏差记录**
1. 删除角色模板时服务端级联清理其关系与节点坐标（原计划未写明级联行为；与前端 purgeTemplate 语义一致，避免悬挂引用）。
2. 前端关系的成对/单项修改采用「读-改-写」整体覆盖（PUT /api/relationships），未用服务端粒度接口——画布操作低频（拖拽仅在 drag-stop 保存一次），换简单性。
3. store 变更方法返回值从「新列表」改为 void（调用点全部 fire-and-forget，无人消费返回值）。
4. `LibraryImportPayload` 载荷类型放宽为 id 可选（脏数据跳过是设计行为，类型应反映运行时容错）。

### 2026-09-28 Wave 2：四协议适配器 tools 支持 ✅

**产出**
- `types/index.ts`：`ApiMessage` 扩展可选字段（`toolCalls` / `toolCallId` / `name`）+ role 增补 `'tool'`；新增 `AgentToolCall` / `AgentToolSchema`
- `ai/providers/types.ts`：`ChatOpts` += `tools`；`ChatResult.toolCalls` 必填（空数组 = 无调用）
- 新增 `ai/providers/tool-support.ts`：`ToolCallAssembler`（流式分片按 index 归位组装）+ `parseToolInput`（坏参数丢弃）
- 四适配器全部支持：请求侧 tools 线格式转换 + assistant/tool 消息回传转换；响应侧流式与非流式的 tool_calls 解析
  - openai：嵌套 function schema、tool_calls 分片、tool_call_id
  - anthropic：input_schema 平铺、tool_use/tool_result 内容块、input_json_delta 分片
  - gemini：functionDeclarations（剥离 additionalProperties）、functionCall/functionResponse parts、无原生 id → 合成 id
  - openai-responses：扁平 function schema、output_item.done 完整 function_call、function_call_output
- 新增 `src/ai/tools.test.ts`（12 用例，mock fetch 假 SSE 流）

**验收结论**
- `pnpm test` 75/75 绿（旧 63 全过 = 不传 tools 的行为回归无损）；`pnpm typecheck` 干净
- 真实上游的工具调用未实测（需要真实 API key 与支持 function calling 的模型）→ 列入未验证清单，Wave 3/4 联调时由用户真人复核

**偏差记录**
1. `ChatResult.toolCalls` 设计为必填空数组（计划中未写明），调用方无需判空。
2. Gemini 的 functionResponse 回传把工具结果文本包成 `{ result: content }`（NovAI 同款约定）。

### 2026-09-28 Wave 3：Agent 循环核心 + SSE 端点 ✅

**产出**
- 新增 `server/src/agent/tools.ts`：12 个工具（角色/话题/世界观各 list/upsert/delete + 关系 list/set/delete），全部只调 libraryStore 内存函数、零 fs；写操作统一 upsert 语义（id 空 = 新建）；关系工具校验两端模板存在并报出合法 id 清单
- 新增 `server/src/agent/tool-execution.ts`：未知工具 / 参数校验失败 / 执行失败三种异常全部降级为 tool 消息文本回灌（模型自纠），循环永不因单次工具失败中断，且每个 tool_call 恒有配对 tool result
- 新增 `server/src/agent/query.ts`：`runAgentQuery` while 循环（LLM → toolCalls? → 逐个执行回灌 → 续跑），`AGENT_MAX_TURNS=30` 轮次安全阀，abort 在每 step 与每个工具执行前检查，被跳过的工具补占位 tool 消息保证序列合法
- 新增 `server/src/agent/messages.ts`：内存 Map 会话态 + 2h 空闲惰性清理（决策 #5：聊天历史不持久化）
- 新增 `server/src/agent/prompt.ts`：导演助手系统提示词（先查后改 / upsert 全量覆盖警示 / 关系有向 / 删除前口头确认）
- 新增 `server/src/routes/agent.ts`：POST /api/agent/chat → `reply.hijack()` + SSE（delta/tool_call/tool_result/assistant/done/error），首条消息自动注入系统提示词，LLM 失败不自动重试（surfaced 给用户重发）；已注册进 index.ts
- 新增 `server/src/agent/agent.test.ts`（9 用例）与 `server/src/agent/agent-route.test.ts`（4 用例；独立文件 + 先设 DATA_DIR 再动态 import，隔离 providers/library 落盘位置）

**验收结论**
- `pnpm test` 88/88 绿（旧 75 全过 = 无回归）；`pnpm typecheck` 干净
- 计划的全部单测场景落地：完整工具轮回（真实写进隔离 libraryStore + 事件序列 + 第二轮请求线格式回传断言）、未知工具回灌、参数校验失败回灌、执行失败回灌、maxTurns 优雅收尾、预中止零调用、批次中止占位消息、会话存取与 TTL；路由级 fastify.inject 验证 SSE 事件流 / 会话延续（system 提示词 + 完整历史）/ Provider 404 / body 400
- 真实上游仍未实测（沿用 Wave 2 的未验证项，Wave 4 前端联调时用户真人复核）

**偏差记录**
1. 客户端断开检测从 `req.raw.on('close')` 改为 `reply.raw.on('close')`：req 流在 body 读完后即 close（hijack 场景下语义错误），响应流 close 才是「客户端断连或响应结束」的规范信号（Fastify hijack 模式推荐做法），也让 inject 集成测试成为可能。
2. SSE 事件比计划多一组 `error` + `done:{reason:'error'}`（计划 3.6 只列了五种事件），用于 LLM 调用失败时给前端明确的终止信号。
3. tool_call 事件携带的参数是「校验归一化后」的输入（如未传 id 补为 `''`），非模型原始 JSON——保证 UI 展示与实际执行一致。

### 2026-09-28 Wave 4：前端挂件 ✅

**产出**
- 新增 `web/src/components/AgentWidget.vue`（约 460 行，单文件自包含）：
  - 右下角机器人悬浮按钮（z-40，位于各模态 z-50 之下）→ 弹框面板：桌面右下锚定（w-96 / h-min(75vh,42rem)），移动端全屏（isMobile 断点切换）
  - 消息流：用户/助手气泡 + 内联工具行（运行中转圈 / 成功绿✓ / 失败红✕，`已改资产` 徽标，点击展开参数 JSON + 结果摘要）+ 系统提示条（停止/出错/轮次上限）
  - 输入区：textarea（Enter 发送 / Shift+Enter 换行 / 中文输入法 isComposing 保护）+ Provider（含其配置模型）下拉 + 思考强度下拉（复用 fetchThinkingOptions，不支持时隐藏）+ 发送/停止切换
  - 空态问候 + 三条可点示例指令；流式期间尾部光标闪烁（animate-blink）；滚动跟随只在用户贴底时生效
  - 手写 POST SSE 消费（fetch + ReadableStream，EventSource 不支持 POST）；会话 id 组件实例持有（刷新即新会话，对齐决策 #5）
- `App.vue` 全局挂载 `<AgentWidget />`（首页与会话页均可见）

**验收结论**
- `pnpm type-check` 干净；`pnpm build` 成功
- 服务端全链路冒烟（隔离 DATA_DIR + 本地假 OpenAI 上游，零真实 API 消耗）：curl SSE 实测事件序列 delta → tool_call → tool_result(mutated:true) → delta → assistant → done(completed)；`library.json` 落盘正确；同 sessionId 第二次请求携带完整历史与系统提示词
- 浏览器端人工 E2E 未完成：本会话 in-app browser webview 无法 attach（环境限制，三次尝试失败）→ 计划中的手动清单（建角色→设置弹窗核对→改→删→手机宽度全屏）留给用户真人复核
- 副作用记录：冒烟期间误杀了用户运行中的 dev server（pkill 匹配过宽），已按原样（pnpm dev / 23892 / 真实数据目录）重启并确认健康

**偏差记录**
1. 工具行配对策略：tool_result 按「同名 + 最后一个 running」回填（服务端保证 tool_call/tool_result 严格成对顺序下发，前端无需 id 配对——SSE 事件未携带 callId，这是协议面的留白，记录在案）。
2. 资产联动刷新做了 200ms debounce（一批多个工具结果只触发一轮 store refresh），计划只写了「收到 tool_result 后重新拉取」。

### 2026-09-28 Wave 5：收尾 ✅

**产出**
- README 更新：双 Loop 架构说明（对话循环 vs Agent 循环）、导演助手使用段（含安全设计）、模板管理改为服务端化描述、项目结构与文档索引补 `agent/` 与本计划文档
- 全量回归：server `pnpm test` 88/88 绿 + `pnpm typecheck` 干净；web `pnpm type-check` 干净 + `pnpm build` 成功
- 本文档状态全部流转完毕，施工任务结束

**偏差记录**
- 无。

---

## 附：项目规范速查（施工会话自包含用）

- 测试：`cd server && pnpm test`（`node --import tsx --test`）；类型检查：`cd server && pnpm typecheck`；前端构建 `cd web && pnpm build`。
- 提交信息：conventional commits（`feat:` / `fix:` / `refactor:` / `chore:`，中文描述，可带 `(web)`/`(server)` scope）。不 push、不发 PR，除非用户明说。
- 参考项目 NovAI 路径：`/Users/honlnk/project/NovAI/packages/core/src/core/agent/`（query.ts / tools.ts / tool-execution.ts / messages.ts / prompt.ts / model-view.ts）与 `core/llm/protocol/`（四协议 tool 支持）。
- Duet 关键现状文件：`server/src/ws/chatHandler.ts`（对话 loop，不动）、`server/src/store/sessionStore.ts`（落盘模式参照）、`server/src/ai/providers/`（待补 tools）、`web/src/services/templates.ts` 与 `relationships.ts`（待换 REST）、`web/src/stores/template.ts` 与 `relationship.ts`（待适配 async）、`web/src/components/SettingsModal.vue`（模板管理 UI，不动）。
