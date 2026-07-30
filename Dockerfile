# syntax=docker/dockerfile:1
# Duet — 多阶段构建（builder 编译前后端 → runtime 精简运行镜像）

# ──────────────────────────── 阶段 1：构建 ────────────────────────────
FROM node:22-alpine AS builder

# 启用 corepack 以使用确定版本的 pnpm（版本由根 package.json 的 packageManager 字段固定）
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

WORKDIR /app

# 先复制 workspace 清单与 lockfile，最大化利用层缓存
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

# 安装全部依赖（含 dev，构建需要）
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 复制源码
COPY server/ ./server/
COPY web/ ./web/

# 构建：前端产物输出到 server/public，后端编译到 server/dist
RUN pnpm build

# 生产化 server 依赖：剥离 devDependencies
RUN pnpm --filter @honlnk/duet deploy --prod --legacy /deploy/server

# ──────────────────────────── 阶段 2：运行 ────────────────────────────
FROM node:22-alpine AS runtime

# 安全：以非 root 运行
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# 仅复制运行所需的产物 + 精简后的生产依赖
COPY --from=builder /deploy/server/node_modules ./node_modules
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/public ./public
COPY --from=builder /app/server/package.json ./package.json

# 数据持久化目录（会话落盘）
RUN mkdir -p /data && chown -R app:app /app /data
VOLUME /data

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

EXPOSE 3000

USER app

# 入口：直接运行编译产物（已带 shebang）
CMD ["node", "dist/index.js"]
