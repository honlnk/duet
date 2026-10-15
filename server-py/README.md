# duet-langgraph（server-py）

duet 后端的 **Python 3.12 + FastAPI + LangGraph** 重写版。多 AI 自主对话聊天室：2~10 个角色按话题自动轮流对话，各自维护独立记忆（滚动摘要压缩），支持导演指令干预、资产库（角色/话题/世界观模板 + 关系图）与模型驱动的资产管理 Agent。

> 状态：**S0 脚手架**（施工中，计划见仓库 `docs/DEV_PLAN_LANGGRAPH.md`，日志见 `docs/DEV_LOG_LANGGRAPH.md`）。
> 前端复用仓库根 `web/`（Vue 3），数据格式与 TS 版 100% 兼容（`providers.json` / `library.json` 可直接拷贝）。

## 开发

```bash
cd server-py
uv sync                 # 安装依赖（含 dev）
uv run duet-langgraph   # 起服务，默认 http://127.0.0.1:23892
uv run pytest           # 测试
uv run ruff check .     # lint
```

数据目录：`DATA_DIR` 环境变量最优先，默认 `~/.duet-langgraph`。

## 技术栈

| 用途 | 选型 |
|---|---|
| Web 框架 | FastAPI + uvicorn |
| 编排 | LangGraph（StateGraph 主对话图 + checkpointer 会话持久化） |
| 模型接入 | langchain 官方 model 类（openai / openai-responses / anthropic / gemini） |
| 数据校验 | pydantic v2 |
| 测试 / lint | pytest + pytest-asyncio / ruff |
