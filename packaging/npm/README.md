# @honlnk/duet

多智能体自主对话聊天室：给多个 AI 一个话题与身份，让它们自主对话。内置导演助手（Agent），可通过对话直接增删改查角色 / 话题 / 世界观模板与关系图。

## 运行

```bash
npx @honlnk/duet
```

启动后自动打开浏览器（默认 `http://127.0.0.1:23892`）。API Key、模型在页面「设置 → Provider」里配置，数据落盘 `~/.duet/`。

**唯一前置：[uv](https://docs.astral.sh/uv/)**（`brew install uv` 或 `curl -LsSf https://astral.sh/uv/install.sh | sh`）。本包内嵌 Python 后端（wheel，含前端页面产物），由 uv 负责准备 Python ≥3.12 运行环境——无需预装 Python，首次运行下载依赖后会缓存，二次启动很快。

## 常用环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `23892` | 服务端口 |
| `DATA_DIR` | `~/.duet` | 数据目录（providers / 资产库 / 会话 / 导演助手聊天历史） |

## 其他安装方式

- Docker：`git clone` 本仓库后 `docker compose up -d --build`
- 源码：`uv sync` + `pnpm install`，`pnpm dev`

详见 [项目 README](https://github.com/honlnk/duet)。

## 版本说明

- **v2.x**：后端为 Python（FastAPI + LangGraph），经本 npm 包内嵌 wheel 分发；v1（Node/Fastify）的历史会话不迁移，`providers.json` / `library.json` 可直接拷贝到 `~/.duet/` 继续使用。
- v1 用户升级：`npx @honlnk/duet@1` 仍可运行旧版。
