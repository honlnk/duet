# ---- 构建层：uv 安装依赖到独立 venv ----
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.3 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev

# ---- 运行层：非 root + healthcheck ----
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
