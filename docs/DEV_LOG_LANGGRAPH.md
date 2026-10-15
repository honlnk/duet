# duet-langgraph 施工日志（langgraph 分支）

> 按阶段门禁追加：日期 / 阶段 / commit hash / 验收结论 / 偏差记录。计划见 `DEV_PLAN_LANGGRAPH.md`。

## 项目规范速查（开工前核对，S0 记录）

- 提交信息：conventional commits（`feat:` / `fix:` / `refactor:` / `chore:` / `docs:`，中文描述，scope 用 `server-py`）
- 测试：`cd server-py && uv run pytest`；lint：`uv run ruff check .`；启动：`uv run duet-langgraph`
- 不 push、不发 PR，除非用户明说（沿用本仓库纪律）
- TS 版参考源码：`server/src/`（以源码为契约唯一事实）

---

## 2026-10-15 S0 脚手架 ✅

**commit**：见本条目所在 docs 提交的父提交（代码提交 hash 记录于 git log，`feat(server-py): S0 脚手架`）

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
