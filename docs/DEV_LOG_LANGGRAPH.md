# duet-langgraph 施工日志（langgraph 分支）

> 按阶段门禁追加：日期 / 阶段 / commit hash / 验收结论 / 偏差记录。计划见 `DEV_PLAN_LANGGRAPH.md`。

## 项目规范速查（开工前核对，S0 记录）

- 提交信息：conventional commits（`feat:` / `fix:` / `refactor:` / `chore:` / `docs:`，中文描述，scope 用 `server-py`）
- 测试：`cd server-py && uv run pytest`；lint：`uv run ruff check .`；启动：`uv run duet-langgraph`
- 不 push、不发 PR，除非用户明说（沿用本仓库纪律）
- TS 版参考源码：`server/src/`（以源码为契约唯一事实）

---

## 2026-10-15 S0 脚手架 ✅

**commit**：`ed730d2`（代码）+ `c1c5e73`（文档）

**产出**

- `langgraph` 分支（基于 dev，master 冻结不动）
- `server-py/`：uv 工程（pyproject.toml + uv.lock + .python-version=3.12），src 布局 `src/duet_langgraph/`
- `config.py`：PORT 默认 23892、REQUEST_TIMEOUT_MS=30000、ABSOLUTE_MAX_ROUNDS=200、ABSOLUTE_MAX_DURATION_SEC=7200（D4 对齐 TS config.ts），DATA_DIR 优先级 env → `~/.duet-langgraph`
- `routes/health.py`：`/api/health`（7 字段）+ `/api/config/limits`（3 字段），逐字段对齐 TS routes/health.ts
- `main.py`：create_app 工厂 + 控制台入口 `duet-langgraph`（uvicorn）；DUET_ENV 显式优先，控制台入口默认 production
- `store/providers.py`（最小实现）：providers.json 读取容错
- CI：`.github/workflows/ci-python.yml`（uv sync --frozen + ruff + pytest，仅 server-py 路径触发）
- `Dockerfile`：python:3.12-slim 多阶段 + 非 root + HEALTHCHECK + VOLUME /data + EXPOSE 23892（骨架，S5 定稿）
- `server-py/README.md` 骨架；测试 `tests/test_health.py`（3 用例，契约字段断言）

**验收结论**

- `uv run ruff check .` 干净；`uv run pytest` 3/3 绿
- `DATA_DIR=$(mktemp -d) PORT=23893 uv run duet-langgraph` 启动，curl `/api/health` 与 `/api/config/limits` 响应字段与 TS 版逐字段一致（env=production 生效）
- CI 工作流已写就但未在远端跑过（不 push 纪律）→ 未验证清单：推送后确认 Actions 绿

**偏差记录**

1. **契约漂移发现**：TS `routes/sessions.ts` 实际有 6 条路由是计划 §3.1 未列出的——`PATCH /api/sessions/:id/relationships`、`POST /api/sessions/:id/directors`、`DELETE /api/sessions/:id/directors/:iid`、`PATCH /api/sessions/:id/config`、`GET /api/sessions/:id/prompts`（+ `GET /api/sessions/:id` 之外的全部 sessions 子资源）。按计划 §3 纪律以源码为准，S1 全部纳入实现；计划文档 §3.1 表格随 S1 门禁同步补录。
2. env 推断：TS 用 NODE_ENV + dist/src 判断；Python 版用 `DUET_ENV`（显式优先，控制台入口默认 production，源码 uvicorn 默认 development）。字段值域一致，行为等价。
3. TS dev 模式数据目录是项目根 `data/`；Python 版按 D5 统一默认 `~/.duet-langgraph`（显式 DATA_DIR 最优先），不设 dev/prod 分叉——开发期用 DATA_DIR 指向临时目录。

## 2026-10-15 S1 数据与 REST ✅

**产出**

- `schemas.py`：TS types/index.ts 全量 pydantic 翻译（camelCase 别名双向；Session 四个可空状态字段恒序列化为 null，其余 None 省略——对齐 TS JSON.stringify 行为）
- `store/providers.py`：providerStore 全量平移（normalizePricing 默认值 / maskKey / apiKey 空串不修改 / pricing 部分合并 / 默认 Provider 不可删 / 无 Provider 仅警告）
- `store/library.py`：libraryStore 全量平移（upsert 语义 / 级联删除关系与坐标 / cleanRelationships / import 幂等）
- `store/session_store.py`：**存储介质改为 sqlite**（DATA_DIR/duet.db 的 sessions_meta 表），行为对齐 TS（列表倒序 / running→stopped 恢复 / addStats 增量成本三维缓存）；S2 的 SqliteSaver 将共用同一 db 文件
- `store/prompt_history.py`：环形缓冲平移（每角色 20 条，内存态）
- `ai/probe.py`：httpx 直连各协议原生端点——listModels（openai/responses /models、anthropic /v1/models、gemini /v1beta/models）+ thinking-options（anthropic 动态探测 / openai+gemini 模型名启发式），对齐 TS 四适配器与 thinking-options.ts
- `routes/`：providers（8 路由）、library（14 路由）、sessions（10 路由，含源码多出的 5 条子资源路由）、pricing（OpenRouter 代理 + 评分匹配）、exchange（三层降级缓存）
- `ws/runtime.py`：客户端注册 / 广播 / 运行时同步（relationships / directors / config / reading）注册表——S2 主循环挂载点
- `main.py` lifespan：启动恢复 + provider 校验
- 测试：conftest（每测试隔离 DATA_DIR）+ 16 用例（契约字段集断言 + 行为断言）

**验收结论**

- `uv run ruff check .` 干净；`uv run pytest` 16/16 绿
- 真实进程冒烟（PORT=23894 + 临时 DATA_DIR）：建会话（字段形状与 TS 逐字段一致）→ 列表 → 加导演指令（genId 同构）→ 模板空列表，全部正常
- 未触网验证：pricing/exchange 上游调用以 monkeypatch mock 验证（真实上游在 V4 冒烟覆盖）

**偏差记录**

1. **会话存储用 sqlite 而非「每会话一个 JSON 文件」**：计划未指定 Python 版会话文件格式（sessions 明确不迁移，无历史包袱）。sqlite 单文件承载 sessions_meta，S2 的 SqliteSaver checkpointer 复用同一 db（DATA_DIR/duet.db），避免「JSON 文件 + sqlite checkpoint」双存储介质。前端契约不变（REST 响应形状一致）。
2. `GET /api/sessions/:id` 从 sessions_meta 组装（写穿式）而非「从 checkpoint 组装」（计划 §5.1 要点）：idle 会话从未跑图、没有 checkpoint，从 checkpoint 组装必然需要第二数据源；写穿式保持单一真相源。checkpointer 仍承担图运行态持久化与崩溃恢复。待 S2 落地后复核。
3. 探测层（listModels/thinking-options）不经 langchain model 类直连原生 REST：langchain 不提供 list-models 能力，这是 REST 面的等价实现，不影响 D2（对话与 Agent 主链路仍走 langchain）。
4. TS normalizeLegacySession（智能体时期旧数据归一化）不移植：无旧数据输入（sessions 不迁移）。
5. 计划 §3.1 已补录源码多出的 6 条 sessions 路由（见 S0 偏差 1）。

## 2026-10-15 S2 主图 + WS ✅

**产出**

- `ai/prompts.py`：五段式 system / 开场 / `[name]: content` 包装 / 摘要三件套 / 导演注入，中文文案逐字对齐 TS prompts.ts
- `ai/models.py`：make_model 工厂——openai→ChatOpenAI、openai-responses→ChatOpenAI(use_responses_api)、anthropic→ChatAnthropic、gemini→ChatGoogleGenerativeAI；thinking 档位按协议映射（reasoning_effort / reasoning:{effort} / thinking:{type} / generationConfig.thinkingConfig）；usage_from_message 归一化（原始 usage 优先，回退 usage_metadata：hit=cache_read、miss=input-hit）
- `memory/context.py`：CharacterMemory（push_self/push_other/摘要/裁剪/组装 API messages，导演指令尾部注入用消息克隆）；restore_memories
- `graph/state.py`：DuetState TypedDict（session 全量 JSON 真相源 + memories + 轮转字段）；运行期非序列化信息（Provider 连接、汇率、广播函数）经 ContextVar 注入，不进 checkpoint
- `graph/nodes.py`：七节点——check_stop（停止条件优先级对齐 TS：用户停止→maxRounds→全局轮数→用户时长→全局时长，各分支置 finishedReason）→ summarize_memory（S4 占位直通）→ build_context（A 首轮开场提示 / prompt 快照落盘）→ character_reply（astream 流式 chunk + 指数退避重试 10 次上限 60s，退避期间停止→优雅退出，耗尽→error）→ post_reply（统计 / 消息 / 记忆写穿 / message_done+stats+turn_end 广播）→ select_speaker（round-robin）→ finish（running→finished / stoppedAt / finished 广播）
- `graph/chat_graph.py`：StateGraph 编译（recursion_limit=2000）+ AsyncSqliteSaver（thread_id=sessionId）
- `ws/chat_ws.py`：`/ws/chat` 端点（每连接出站队列保序；sync-on-connect；ping/pong、start、stop、reading 消息处理；JSON 非对象容错）+ run_loop 驱动（重复 start / 状态守卫、每角色 Provider 解析与 CostRates、货币选举 + 汇率兜底、计时重置语义对齐 TS：继续时重置 startedAt）
- WS 事件落地：sync / started / chunk / message_done / stats（9 字段顶层）/ turn_end / stopping / finished / error / retry / pong + S1 已有 director_added / director_removed；summary×3 留 S4；pacing 不实现（R6 决策）
- 测试：`test_s2_ws.py` 8 用例（fake 模型 monkeypatch make_model）——全链路 2 轮×2 角色事件序列与落盘（记忆条数/角色视角/统计/token 三维）、退避重试、重试耗尽 error、优雅停止（gate 门控当前发言完成后停止）、重复 start 拒绝、连接协议（sync/ping/非法消息/缺 sessionId/会话不存在）

**验收结论**

- `uv run ruff check .` 干净；`uv run pytest` 24/24 绿；全套件连跑 6 次无 flakes（~0.3s/轮）
- 真实进程冒烟（临时 DATA_DIR + 真实 uvicorn）：health / 建删会话 / WS sync+ping×4 → start（无 Provider）→ started+error，行为与 TS 同路径一致（TS 此路径同样不广播 finished）
- 测试侧曾暴露真实缺陷：sessions_meta（同步 sqlite，事件循环线程）与 checkpointer（aiosqlite，工作线程）写同一 duet.db 跨线程写锁互卡（`database is locked`，偶发死锁/崩溃）——已分库修复，见偏差 1

**偏差记录**

1. **checkpoint 与 sessions_meta 分库**：checkpointer 改存 `DATA_DIR/checkpoints.db`（S1 偏差 1 中「复用同一 duet.db」的设计作废）。SQLite 单写者，两个独立写入方（同步连接在事件循环线程 + aiosqlite 在工作线程，后者完成回调依赖事件循环）共用一个文件会形成跨线程锁依赖，实测偶发 `database is locked` 且难复现。分库后彻底消除竞争；两库仍在同一 DATA_DIR。
2. **REST 运行中修改经 live 对象合并进图状态**：图节点从 state 快照解析 session，而 REST 路由（加导演/改关系/改 pacing 配置）只改 `rt.active_session`——`_parse_session` 在每个节点入口合并 directors/relationships/pacing 四个字段，`post_reply` 推进 live 指针。TS 是单对象引用天然可见，此处为等价实现。附带修复：S1 的 `sync_config_to_runtime` 传 camelCase key 去 setattr pydantic 会崩，改传 snake_case。
3. **记忆每轮写穿落盘**：TS 在循环退出时统一把 memory 写回 session；Python 版 post_reply 每轮写穿（崩潛建议面更小），契约无差。
4. **退避期间停止的终态**：TS 此路径经循环退出块得到 status=finished + reason=stopped（怪癖）；Python 直接置 status=stopped + finishedReason=stopped（语义更自洽，前端对两者展示等价）。另 check_stop 各停止分支同时置 finishedReason（对齐 TS 逐行）。
5. 每次运行都以最新 sessions_meta 组装全新 input 跑图（checkpoint 被覆盖）；checkpoint 承担运行中断点续跑与 LangGraph 状态留痕，不承担跨运行累积——与 TS「重开即从头」语义一致（S1 偏差 2 的复核结论）。
6. 无 Provider 提前返回路径只广播 started+error 不广播 finished——逐行对齐 TS（前端靠 error 事件恢复 UI）。
7. `ai/prompts.py` 加 ruff E501 豁免（逐字移植的中文文案不折行）。

## 2026-10-15 S3 导演 Agent ✅

**产出**

- `agent/prompt.py`：导演助手系统提示词逐字平移（19 条工作原则）
- `agent/tools.py`：12 工具全量平移（list/upsert/delete × 角色/话题/世界观 + list/set/delete 关系）——pydantic args_schema（extra=forbid ≙ TS additionalProperties:false）+ isWrite 标记 + summarize + 校验错误中文文本回灌
- `agent/messages.py`：会话态内存 Map + TTL 2h 惰性清理（对齐 TS：聊天历史不持久化）
- `agent/query.py`：Agent 循环落成 LangGraph StateGraph（agent_step ⇄ tool_step，add_messages reducer；无 checkpointer，会话态由 messages 持有、每轮整体传入/写回）——停止/30 轮安全阀在 step 边界检查；流式 delta；工具批次顺序执行回灌；未知工具/校验失败/执行失败均回灌不崩循环；abort 时批内剩余工具补「已因用户停止而跳过」保持消息序列合法
- `routes/agent.py`：POST /api/agent/chat → SSE（delta / tool_call / tool_result / assistant / done / error 六事件；providerId 404 守卫；body.model 覆盖 Provider 模型；客户端断开 → 生成器 finally 置 abort）
- `main.py` 挂载 agent 路由；conftest 增加 agent 会话态重置

**验收结论**

- `uv run ruff check .` 干净；`uv run pytest` 32/32 绿；连跑 4 次无 flakes（~0.38s/轮）
- 测试：工具往返 + SSE 事件契约（mutated 联动真实改库、REST 可见）、未知工具/参数校验失败回灌、30 轮安全阀、LLM 错误 surfaced（error+done(error)）、provider 404、body 422、abort 前置（零 LLM 调用）、abort 跳过批内剩余工具（消息序列完整性）
- 真机冒烟：`/api/agent/chat` 无 Provider → 404 JSON；缺字段 → 422（真实 LLM 循环在 V4 冒烟覆盖）

**偏差记录**

1. Agent 图无 checkpointer（TS 也是纯内存会话态）：每次 ainvoke 全量传入消息、结束写回 `messages[:]`——与 TS 原地追加语义等价。
2. 工具 schema 经 pydantic model_json_schema（numbered OpenAI function 格式）传 `bind_tools`，由 langchain 转各协议线格式；openai 路径与 TS 逐字段同构，anthropic/gemini 的工具转换正确性留 V4 真机验证。
3. 校验错误文本：TS 手写中文校验器；Python 用 pydantic ValidationError 详情拼中文前缀（回灌语义一致，具体措辞不同——模型自纠所需信息等价）。

## 2026-10-15 S4 记忆与统计 ✅

**产出**

- `memory/summarizer.py`：summarize_conversation——摘要走该 Character 的 Provider（剥离 thinkingConfig），temperature 0.3 / maxTokens 600（对齐 TS chatComplete 参数）；返回 (第一人称摘要, usage)
- `graph/nodes.py summarize_memory` 实装（替换 S2 占位）：触发条件对齐 TS（messages > keepRecent 且距上次摘要 >= summaryEveryN）→ summary/start → 生成 → addStats（摘要成本按该角色单价+展示货币计入会话统计）→ applySummary → trimToRecent → summary/done；失败广播 summary/error 不致命
- WS 事件补齐第 15 种：summary（start/done/error 三相位）
- `scheduling: "llm"` 开关（D3 新增，TS 无）：SessionConfig 可选字段（None=默认轮转，序列化省略 → REST 契约默认形状与 TS 逐字段一致）；建会话 config / PATCH config 均可设置；select_speaker 在 scheduling=llm 且未临近轮数上限时调模型选人（正则解析 A–J，失败/异常回落 round-robin），选人 usage 计入统计；`_parse_session` live 合并纳入 scheduling（运行中切换生效）
- `ai/models.content_text`：langchain 消息文本提取公共助手
- 测试 5 例（`test_s4_summary.py`）：摘要触发/裁剪/注入（prompt 快照含「对话进展摘要」system 消息）、摘要失败不致命、usage 三维缓存累计断言（prompt/completion/hit/write/miss 精确值）、llm 选人解析与双回落、scheduling=llm 全链路覆盖轮转（3 角色恒选 A → A,A,A；最后一轮跳过选人）

**验收结论**

- `uv run ruff check .` 干净；`uv run pytest` 37/37 绿；连跑 3 次无 flakes
- 真机冒烟：建会话带 `scheduling:"llm"` 配置回读正确；PATCH config 置 null 回退默认

**偏差记录**

1. 计划提到的「RemoveMessage」未采用：langgraph 的 RemoveMessage 是 chat-history reducer 概念，而本实现展示层消息（session.messages）与记忆层消息（memory.messages）分离——摘要裁剪作用于记忆列表（trim_to_recent），与 TS trimToRecent 语义一致，无需 RemoveMessage。
2. 摘要后记忆上限：trim 到 keepRecent 后、下次摘要触发前会再累积一轮对话，故记忆条数上限为 keepRecent + 角色数（TS 同此行为，测试断言按此边界）。
3. scheduling=llm 的选人调用在每次 post_reply 后发生；临近 maxRounds 时跳过（避免最后一轮浪费调用），其余停止条件（时长等）下可能多一次调用——低频场景，接受。
4. scheduling 为新增功能（TS 无）：前端无 UI 入口，经 REST 配置启用；默认不序列化，契约零变更。
