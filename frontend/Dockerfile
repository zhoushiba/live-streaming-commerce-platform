# 前端镜像：Vue 3 + Vite 构建成静态产物，交给 nginx 托管
# 构建上下文是仓库根目录（docker-compose 中 context: .），这样可以复用根目录的 nginx 配置
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine AS runner

ENV TZ=Asia/Shanghai

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
