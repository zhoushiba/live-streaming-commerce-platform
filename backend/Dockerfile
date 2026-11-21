# 后端镜像：NestJS + TypeScript，生产用 MySQL（本地开发仍可用 better-sqlite3）
FROM node:22-bookworm-slim AS builder

# better-sqlite3 需要编译原生模块，装最小构建工具链
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Shanghai

WORKDIR /app

# 运行期只需要已编译产物与生产依赖
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN mkdir -p storage/media storage/uploads storage/streams \
  && useradd -r -u 10001 -m appuser \
  && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
