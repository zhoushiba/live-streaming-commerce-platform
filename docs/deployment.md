# 部署与运行（deployment）

> 本文分三种运行方式：**本地开发（默认，零外部依赖）**、**本地生产构建**、**docker-compose（MySQL + 后端 + nginx）**。
> 所有命令都在仓库根目录执行，Windows PowerShell / macOS / Linux 均可。

## 1. 前置要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20（开发用 24.x 验证） | 后端与前端构建 |
| npm | ≥ 10 | 用 `npm.cmd`（Windows PowerShell 下避免执行策略拦截） |
| MySQL | 8.0（可选） | 不装也能跑：默认 SQLite |
| Docker | 24+（可选） | 一键起 MySQL + 后端 + nginx |
| 浏览器 | Chrome / Edge | 播放器依赖 MSE（hls.js） |

## 2. 本地开发（推荐，默认 SQLite）

```bash
# 1) 安装依赖（前端、后端各一次）
cd backend && npm install
cd ../frontend && npm install

# 2) 配置环境变量（不配也能跑，全部有开发默认值）
cd ..
cp .env.example .env          # Windows: Copy-Item .env.example .env

# 3) 启动后端（首次启动自动建表 + 写入种子数据）
cd backend
npm run build                 # nest build → dist/
npm start                     # http://localhost:3000

# 4) 另开终端启动前端（Vite dev server，自带 /api 代理）
cd frontend
npm run dev                   # http://localhost:5173
```

访问：

- 前端：<http://localhost:5173>（hash 路由，`/#/room/1` 直达直播间）
- 后端 API：<http://localhost:3000/api/health>
- Swagger：<http://localhost:3000/api/docs>

> 已有 `backend/node_modules` / `frontend/node_modules` 时不要重复 `npm install`。

## 3. 本地生产构建（不依赖 Docker）

```bash
# 后端
cd backend
npm run build
npm start                     # 生产形态：node dist/main.js

# 前端
cd frontend
npm run build                 # vue-tsc 类型检查 + vite build → dist/
```

前端是纯静态产物，本地可以用仓库自带的小服务器预览（同时把 `/api`、`/media`、`/socket.io` 反代到 3000，避免 CORS）：

```bash
# 仓库根目录
node scripts/serve-web.mjs --port 4173
# 打开 http://127.0.0.1:4173/#/
```

生产环境请用 nginx 托管 `frontend/dist`，配置见 [`nginx/default.conf`](../nginx/default.conf)（静态缓存 + 四个反向代理 + WebSocket upgrade + 媒体 Range 透传）。

## 4. docker-compose（MySQL + 后端 + nginx）

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| `db` | 3306 | MySQL 8，`utf8mb4`，自动执行 `db/schema.mysql.sql` |
| `backend` | 3000 | NestJS，`DB_CLIENT=mysql` + `DB_AUTO_MIGRATE=true` + `SEED_ON_BOOT=true` |
| `web` | 8080 | nginx 托管前端产物，并把 `/api` 等反代到 backend |

访问 <http://localhost:8080>，API 文档 <http://localhost:3000/api/docs>。

- 数据库数据在 `mysql-data` volume，后端媒体在 `backend-storage` volume；
- 改 `.env` 里的 `DB_PASSWORD` / `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `MOCK_PAY_SECRET` 后再上线；
- 镜像构建：`backend/Dockerfile`（多阶段 + 非 root 用户 + healthcheck）、`frontend/Dockerfile`（node 构建 → nginx 运行）。

## 5. 环境变量矩阵（关键项）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | development | production 时不写种子数据、不暴露调试信息 |
| `PORT` / `API_PREFIX` | 3000 / api | 后端端口与统一前缀 |
| `PUBLIC_WEB_URL` | http://localhost:5173 | 生成 Mock 支付页跳转地址、CORS 白名单 |
| `CORS_ORIGINS` | 5173 两个来源 | 逗号分隔 |
| `DB_CLIENT` | sqlite | `sqlite` 或 `mysql` |
| `DB_FILENAME` | ./storage/live.db | SQLite 文件（相对仓库根） |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | - | MySQL 连接参数 |
| `DB_AUTO_MIGRATE` | true | 启动时自动建表（幂等） |
| `JWT_ACCESS_SECRET` / `JWT_ACCESS_TTL` | dev 占位 / 900 | 访问令牌密钥与有效期（秒） |
| `JWT_REFRESH_SECRET` / `JWT_REFRESH_TTL` | dev 占位 / 604800 | 刷新令牌密钥与有效期（秒） |
| `CACHE_DRIVER` | memory | `memory` 或 `redis`（redis 不可用自动降级） |
| `STREAM_DEMO_MODE` | true | true 时未推流也返回演示播放源 |
| `MOCK_PAY_SECRET` / `MOCK_PAY_TTL_MINUTES` | dev 占位 / 15 | Mock 渠道 HMAC 密钥与回调时间窗 |
| `WECHAT_*` / `ALIPAY_*` | 示例值 | 见 [`docs/payment.md`](./payment.md) |
| `SEED_ON_BOOT` | 非生产 true | 启动写入演示数据 |

完整列表见 [`.env.example`](../.env.example)。

## 6. 上线检查清单

- [ ] `.env` 里的 4 类密钥全部替换为随机值（JWT × 2、Mock 支付、渠道密钥）
- [ ] `DB_PASSWORD` 不再使用示例值，MySQL 不对公网开放 3306
- [ ] `CORS_ORIGINS` 只保留真实域名
- [ ] `SEED_ON_BOOT=false`（生产不要写演示账号）
- [ ] `PUBLIC_WEB_URL` / `WECHAT_NOTIFY_URL` / `ALIPAY_NOTIFY_URL` 换成 https 域名
- [ ] nginx 配好 TLS（可直接在 `nginx/default.conf` 增加 443 server 块）
- [ ] `docker compose up -d` 后跑一次 `scripts/smoke-payment.mjs` 验证支付链路

## 7. 冒烟验证

```bash
# 后端已在 3000 运行时：注册 → 登录 → 下单 → Mock 支付回调 → 查余额/权益
node scripts/smoke-payment.mjs
```

输出会依次打印每步的 HTTP 状态与关键字段（订单号、outTradeNo、granted 明细、余额变化），用于人工确认整条链路。

## 8. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 前端 401 后不停刷新 | refresh token 也失效时会清空本地令牌并跳登录，属预期；检查 `JWT_REFRESH_SECRET` 是否重启后变化 |
| 页面空白 + 控制台 404 | 用 `file://` 直接打开 dist 会失败，请用 `node scripts/serve-web.mjs` 或 nginx；路由是 hash 模式 |
| 播放器提示"演示环境没有真实切片" | 未接 CDN/推流时属正常：`STREAM_DEMO_MODE=true` 会用 Canvas 演示态；接入真实流见 `docs/architecture.md` |
| `npm test` 报端口占用 | 测试不监听端口，通常是有残留 jest 进程；关闭后重跑 |
| SQLite `database is locked` | 写并发过高；测试与本地都是单连接池（`pool max=1`），生产请用 MySQL |
