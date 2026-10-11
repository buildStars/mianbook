# 生产镜像，在服务器上构建（部署脚本把 git 里已提交的代码传到服务器）。
# app：只带 Nuxt 构建产物 .output，体积小；tools：带完整源码和依赖，用来迁移数据库、导入题目

FROM node:24-bookworm-slim AS build
WORKDIR /app
# 服务器只有 4G 内存，限制 Node 堆大小，避免构建时被系统杀掉
ENV NODE_OPTIONS=--max-old-space-size=2048
COPY . .
RUN npm ci --no-audit --no-fund && npm run build

FROM build AS tools
ENV NODE_OPTIONS=
CMD ["npx", "tsx", "scripts/db.ts", "migrate"]

FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
