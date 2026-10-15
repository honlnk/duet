# syntax=docker/dockerfile:1
# 三层构建：
#   1. web-builder：pnpm 构建前端 → server-py/src/duet_langgraph/public
#   2. builder：uv 打 wheel（自带前端产物）+ 装依赖到独立 venv（非 editable，运行层零源码）
#   3. 运行层：非 root + healthcheck
#
# 构建上下文必须是仓库根目录（需访问 web/ 与 pnpm-lock.yaml）：
#   docker build -f server-py/Dockerfile .

# ---- 1. web 构建层 ----
FROM node:22-alpine AS web-builder
RUN corepack enable
WORKDIR /repo
# 先只拷清单，最大化命中 pnpm store 缓存
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json web/package.json
COPY server/package.json server/package.json
RUN pnpm install --frozen-lockfile --filter web...
COPY web ./web
# vite outDir=../server-py/src/duet_langgraph/public（相对 web/）
RUN pnpm --filter web build

# ---- 2. Python 构建层 ----
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY server-py/pyproject.toml server-py/uv.lock server-py/README.md ./
COPY server-py/src ./src
COPY --from=web-builder /repo/server-py/src/duet_langgraph/public ./src/duet_langgraph/public
# wheel 经 artifacts 带上 public/；依赖来自 lock 导出，与 uv sync 同源
RUN uv build --wheel --out-dir /dist \
 && uv venv /app/.venv \
 && uv export --frozen --no-dev --no-emit-project -o /requirements.txt \
 && uv pip install --python /app/.venv/bin/python -r /requirements.txt /dist/*.whl

# ---- 3. 运行层 ----
FROM python:3.12-slim
RUN useradd --create-home --uid 1000 duet
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" \
    DATA_DIR=/data \
    DUET_ENV=production
RUN mkdir /data && chown duet:duet /data
USER duet
EXPOSE 23892
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:23892/api/health', timeout=3)"
CMD ["duet-langgraph"]
