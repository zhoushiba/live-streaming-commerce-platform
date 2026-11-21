# 需求说明（requirements）

> 项目：**星播 Live · 直播电商与付费内容平台**
> 定位：直播 + 点播的付费内容平台，覆盖「主播开播 → 观众观看 → 实时互动 → 下单支付 → 权益发放 → 对账退款」完整链路。
> 对标岗位：深圳市业冕七数字科技有限公司 · 直播平台前后端开发（Vue/Node/Java/PHP）。

## 1. 背景与目标

招聘 JD 的硬性要求集中在四件事：**后端服务能力（Node.js）**、**MySQL 建表/事务/索引**、**JWT 鉴权**、**微信/支付宝支付对接**；
前端要求 **Vue + axios + flv.js/hls.js 直播播放**，并且明确写了「有能力完成直播播放 + 支付对接者薪资可面议」。

因此本项目不是 CRUD 演示，而是围绕两个"硬技能"做的完整业务闭环：

1. **直播播放链路**：房间状态机 → 播放地址签发（HLS/FLV 双协议 + 鉴权 token）→ 前端 hls.js/flv.js 自适应播放 → 断流重连与降级；
2. **支付对接链路**：下单（幂等）→ 渠道抽象（微信/支付宝/Mock）→ 回调验签 → 流水幂等 → 事务发放权益 → 对账与退款。

## 2. 角色与权限

| 角色 | 说明 | 关键权限 |
| --- | --- | --- |
| 观众 viewer | 平台普通用户 | 浏览房间/点播、发弹幕、送礼、下单支付、查看自己的订单与权益 |
| 主播 anchor | 内容生产者 | 创建/编辑自己的直播间、开播下播、查看推流信息与实时数据；不能操作他人房间 |
| 运营 admin | 平台运营 | 全站数据看板、用户封禁、强制下播、弹幕下架、订单查询、支付对账 |

权限模型分两层：

- **接口级**：`JwtAuthGuard`（默认全局启用，`@Public()` 显式放行）+ `RolesGuard`（`@Roles('anchor','admin')` 按角色等级判定，viewer=1 / anchor=2 / admin=3）。
- **资源级**：房间、订单、支付单、权益在 Service 层校验归属（如 `findRoomOwnedBy`、`assertPayable`、支付单查询校验 `order.user_id`）。

## 3. 功能需求与实现状态

### A. 用户与鉴权

- [x] 注册 / 登录 / 刷新令牌 / 登出；密码 bcrypt 加盐存储
- [x] Access Token 15 分钟 + Refresh Token 7 天，refresh 只存 `sha256` 哈希，刷新时轮换并立即吊销旧令牌
- [x] 令牌黑名单（登出后 access 立即失效），内存实现，可切 Redis
- [x] 登录失败计数与账号锁定（默认 5 次 / 锁 15 分钟）
- [x] 个人资料更新（昵称、头像）

### B. 直播与点播

- [x] 房间 CRUD、分类、封面、计费方式（免费 / 包月 / 包年）
- [x] 直播状态机 `idle → living → ended`，重复开播/未开播关播返回明确业务错误
- [x] 播放地址下发：HLS 多清晰度 + FLV 兜底，URL 带 HMAC 签名 token（`roomId + userId + exp`）
- [x] 前端 hls.js / flv.js 双引擎播放器，支持清晰度切换、断流重连、播放器 UI（播放/音量/全屏/画质/缓冲态）
- [x] 演示模式（`STREAM_DEMO_MODE=true`）：无真实推流时，播放器用 canvas 状态机渲染"直播画面"，保证开箱即可演示
- [x] 推流信息：RTMP 地址、串流密钥、ffmpeg/OBS 参数（仅房主与管理员可见）
- [x] 点播：剧集/单集、免费试看、购买后解锁播放地址、播放计数

### C. 实时互动

- [x] Socket.IO 网关（`/ws` 命名空间），房间隔离（join/leave）
- [x] 弹幕：敏感词拦截 + 屏蔽词打码、频率限制（5 秒 5 条）、历史弹幕回放、运营下架
- [x] 礼物：目录、余额事务扣减（`UPDATE ... WHERE balance >= ?`）、`requestId` 幂等、榜单、礼物特效消息广播
- [x] 进场提示、在线人数、点赞

### D. 交易与支付

- [x] 商品模型：付费房间会员（月/年）、点播单片、钱包充值
- [x] 订单：下单 → 待支付 → 已支付 / 已关闭 / 已退款；订单号规则；`idempotencyKey` 幂等；15 分钟超时自动关单（定时任务）
- [x] 支付渠道抽象 `PaymentProvider`：`MockPayProvider`（默认，本地可演示）、`WechatPayProvider`、`AlipayProvider`（沙箱模式保留完整报文与验签逻辑）
- [x] 回调：验签 → 金额校验 → 流水 CAS 幂等 → 事务内改订单 + 发放权益 + 钱包入账 → 应答；重复回调不重复发货
- [x] 退款：管理员发起 → 渠道退款 → 事务内订单置 refunded + 退款单 + 权益回收 / 余额扣回
- [x] 对账：按日 + 渠道比对本地流水与渠道账单，写 `reconciliation_log` 并输出差异

### E. 运营后台

- [x] 数据看板（用户、直播间、订单、成交额、礼物流水、弹幕数、支付渠道分布）
- [x] 用户封禁/启用、直播间强制下播、弹幕下架
- [x] 订单列表（按状态筛选）、支付对账执行与结果查看

## 4. 非功能需求

| 类别 | 要求 | 落地方式 |
| --- | --- | --- |
| 一致性 | 金额与权益不能重复发放 | 支付流水唯一键 + `UPDATE ... WHERE status='pending'` 的行级 CAS |
| 并发安全 | 余额不能扣成负数 | `UPDATE user_balance SET balance = balance - ? WHERE user_id = ? AND balance >= ?`，受影响行数为 0 即拒绝 |
| 幂等 | 下单、送礼、支付回调可重放 | `orders.idempotency_key` 唯一键、`gift_record.request_id` 唯一键、`payment_transaction.out_trade_no` 唯一键 |
| 可观测 | 全链路可排查 | 统一响应信封 + `requestId`（`X-Request-Id` 透传）+ 结构化日志 |
| 可测试 | 不依赖外部服务 | 测试用临时 sqlite 文件，每个套件独立数据库，`npm test` 零外部依赖 |
| 安全 | 密钥不入库不入仓 | `.env.example` 只放占位值，`.gitignore` 排除 `.env`、`storage/`、证书文件 |

## 5. 验收标准（与实现对照）

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| `npm test` 全绿，覆盖 JWT/订单幂等/回调重复/余额不超扣/弹幕敏感词限流 | ✅ | 6 个套件 73 个用例，见 README「测试」 |
| 后端真实启动，curl 走通 注册 → 登录 → 下单 → 模拟回调 → 权益到账 | ✅ | `scripts/smoke-payment.mjs` 可一键复现 |
| 前端 `npm run build` 成功，播放器在有流时可播 | ✅ | `vue-tsc` 类型检查 + `vite build` 通过 |
| `db/schema.mysql.sql` 含主键/唯一键/组合索引/外键、DECIMAL(12,2)、utf8mb4 | ✅ | 20 张表，详见 `docs/database.md` |
| `docs/payment.md` 说明微信/支付宝正式接入要替换的配置与密钥 | ✅ | 见 `docs/payment.md` |
| 至少 3 张真实运行截图 | ✅ | `docs/screenshots/` 共 6 张 |
