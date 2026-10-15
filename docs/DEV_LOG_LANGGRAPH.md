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
