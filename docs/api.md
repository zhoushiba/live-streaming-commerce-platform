# 接口文档（API）

> Base URL：`http://localhost:3000/api`（本地）· 在线文档：`http://localhost:3000/api/docs`（Swagger UI）
> 所有 REST 响应统一信封：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "requestId": "b1f0c9d2a3e4f567",
  "timestamp": "2026-11-22T00:00:00.000Z"
}
```

- `code = 0` 表示成功，非 0 为业务错误码（见文末错误码表）；
- 鉴权走 `Authorization: Bearer <accessToken>`；带 `@Public()` 的接口不强制登录，但登录后会额外返回访问者视角字段（如 `access.canWatch`）；
- 微信/支付宝回调使用 `@RawResponse()`，返回渠道要求的原始格式（微信 JSON、支付宝纯文本 `success`），不套信封。

## 1. 健康检查

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 公开 | 服务状态、数据库连通性、当前 stream/pay 模式、运行时长 |

```bash
curl http://localhost:3000/api/health
```

## 2. 认证（`/auth`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/auth/register` | 公开 | 注册（可选 role：viewer/anchor），返回双令牌 + 用户信息 |
| POST | `/auth/login` | 公开 | 登录，失败 5 次锁定 15 分钟 |
| POST | `/auth/refresh` | 公开 | 刷新令牌（旧 refresh 立即吊销，轮换） |
| POST | `/auth/logout` | 需登录 | 登出（access 进黑名单 + 吊销 refresh） |
| GET | `/auth/profile` | 需登录 | 当前用户资料（含余额） |
| PATCH | `/auth/profile` | 需登录 | 更新昵称 / 头像 |

```bash
# 登录取 token
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"viewer","password":"Viewer@123456"}'
```

## 3. 直播间（`/rooms`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/rooms/categories` | 公开 | 分类列表 |
| GET | `/rooms` | 公开 | 房间列表（分页、分类、状态、关键词、排序 `hot/new/price_asc/price_desc`） |
| GET | `/rooms/:id` | 可选登录 | 房间详情 + 购买/观看权限 `access` |
| GET | `/rooms/mine` | anchor/admin | 我的直播间 |
| POST | `/rooms` | anchor/admin | 创建直播间（计费方式 free/monthly/yearly） |
| PATCH | `/rooms/:id` | 房主 | 编辑（直播中禁止改计费方式） |
| POST | `/rooms/:id/live/start` | 房主 | 开播 `idle → living` |
| POST | `/rooms/:id/live/end` | 房主 | 关播 `living → ended` |
| POST | `/rooms/:id/enter` | 可选登录 | 进场（观看人数 +1，写观看记录） |
| POST | `/rooms/:id/like` | 可选登录 | 点赞 |

## 4. 直播流（`/streams`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/streams/:roomId/play-info` | 可选登录 | 播放地址：HLS 多清晰度 + FLV 兜底；付费未购返回锁定态；未开播/demo 模式返回演示源 |
| GET | `/streams/:roomId/health` | 公开 | 流健康检查 |
| GET | `/streams/:roomId/push-info` | 房主/管理员 | RTMP 推流地址、串流密钥、ffmpeg/OBS 参数 |
| GET | `/streams/:roomId/stats` | 房主/管理员 | 实时数据（在线、峰值、时长、估算码率、礼物收入） |

`playInfo` 关键字段：

```json
{
  "mode": "live | demo | offline",
  "sources": [{ "id": "hls-1080p", "protocol": "hls", "quality": "1080p", "url": "...?token=...", "isDefault": true }],
  "fallbackOrder": ["hls-1080p", "hls-720p", "flv-1080p"],
  "token": "...", "expiresAt": "...",
  "locked": false, "lockReason": null,
  "price": { "priceType": "monthly", "amount": 9.9 }
}
```

## 5. 点播（`/videos`、`/entitlements`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/videos` | 公开 | 已上架点播列表 |
| GET | `/videos/:id` | 可选登录 | 详情 + 分集（未购分集 `playUrl=null`、`locked=true`） |
| POST | `/videos/:id/episodes/:episodeId/play` | 需登录 | 取播放地址；未购返回 `{locked:true, price, purchaseHint}`；播放数 +1 |
| GET | `/entitlements/mine` | 需登录 | 我的全部权益（房间会员 / 点播） |
| GET | `/entitlements/videos` | 需登录 | 我解锁的点播 |

## 6. 弹幕（`/rooms/:roomId/danmaku`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/rooms/:roomId/danmaku?limit=50` | 公开 | 历史弹幕（正序返回） |

发送弹幕走 WebSocket（`/ws` 命名空间）：客户端 `emit('join', { roomId })`，服务端推送 `danmaku:new` / `gift:new` / `presence` / `live:status` / `system`。
服务端会做敏感词拦截与打码、5 秒 5 条限流。

## 7. 礼物（`/gifts`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/gifts` | 公开 | 礼物目录（仅上架） |
| GET | `/gifts/leaderboard/:roomId` | 公开 | 房间礼物榜 |
| POST | `/gifts/send` | 需登录 | 送礼（`requestId` 幂等；余额 CAS 扣减，不足返回 409/5001） |
| GET | `/gifts/mine` | 需登录 | 我的送礼记录 |

## 8. 订单（`/orders`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/orders` | 需登录 | 下单（`bizType` room/video/recharge + `idempotencyKey`，重复提交返回同一订单） |
| GET | `/orders` | 需登录 | 我的订单（分页 + 状态过滤） |
| GET | `/orders/:orderNo` | 需登录 | 订单详情（items + payment + entitlement） |
| POST | `/orders/:orderNo/cancel` | 需登录 | 取消待支付订单 |

```bash
# 下单（幂等键 8-64 字符）
curl -s -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"bizType":"room","targetId":1,"idempotencyKey":"demo-room-1-20261122"}'
```

## 9. 支付（`/payments`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/payments/providers` | 公开 | 可用渠道（mock / wechat / alipay） |
| POST | `/payments/create` | 需登录 | 发起支付，返回渠道参数与（mock）回调报文 |
| GET | `/payments/:outTradeNo` | 需登录 | 支付单查询 |
| POST | `/payments/mock/notify` | 公开 | **本地演示主路径**：模拟渠道异步回调（验签 + 幂等 + 发货） |
| POST | `/payments/wechat/notify` | 公开 | 微信支付回调（原始 JSON 应答） |
| POST | `/payments/alipay/notify` | 公开 | 支付宝回调（纯文本 `success` 应答） |
| POST | `/payments/refund/:orderNo` | admin | 退款（渠道退款 → 订单 refunded → 回收权益/扣回余额） |

## 10. 钱包与运营后台

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/wallet/me` | 需登录 | 钱包概览（余额、累计充值、累计消费） |
| GET | `/wallet/transactions` | 需登录 | 资金流水（分页） |
| GET | `/admin/stats` | admin | 数据看板 |
| GET | `/admin/users` | admin | 用户列表（关键词） |
| PATCH | `/admin/users/:id/status` | admin | 封禁 / 启用（不能禁用自己） |
| GET | `/admin/orders` | admin | 全部订单（状态过滤） |
| GET | `/admin/rooms` | admin | 全部直播间 |
| POST | `/admin/rooms/:id/close` | admin | 强制下播 |
| POST | `/admin/danmaku/:id/hide` | admin | 弹幕下架 |
| POST | `/admin/reconciliation` | admin | 执行对账（默认昨天 + mock） |
| GET | `/admin/reconciliation` | admin | 对账历史 |

## 11. WebSocket 事件

| 方向 | 事件 | 载荷 |
| --- | --- | --- |
| C→S | `join` | `{ roomId }` |
| C→S | `leave` | `{ roomId }` |
| C→S | `danmaku:send` | `{ roomId, content, color? }` |
| S→C | `danmaku:new` | `{ id, roomId, userId, nickname, content, color, sentAt }` |
| S→C | `gift:new` | `{ giftName, icon, count, nickname, roomId }` |
| S→C | `presence` | `{ roomId, viewers }` |
| S→C | `live:status` | `{ roomId, status }` |
| S→C | `system` | `{ message }` |

## 12. 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| 0 | 200/201 | 成功 |
| 9001 | 400 | 参数校验失败（details 里带字段级信息） |
| 9002 | 404 | 资源不存在 |
| 9003 | 429 | 触发限流 |
| 1001 | 401 | 用户名或密码错误 |
| 1002 | 429 | 账号锁定（登录失败次数过多） |
| 1003 | 401 | 令牌无效 |
| 1004 | 401 | 令牌过期 |
| 1005 | 401 | 刷新令牌已失效 |
| 1006 | 403 | 无权限 |
| 2003 | 409 | 直播间状态不允许该操作 |
| 3002 | 409 | 订单状态不允许该操作 |
| 3003 | 409 | 订单已超时关闭 |
| 4001 | 400 | 支付回调验签失败 |
| 4002 | 400 | 不支持的支付渠道 |
| 4003 | 409 | 回调金额与订单不一致 |
| 5001 | 409 | 余额不足 |
| 6001 | 402 | 需要购买权益 |
| 7001 | 400 | 弹幕包含违规内容 |
| 7002 | 429 | 弹幕发送过于频繁 |
