# 支付对接说明（payment）

> 本文说明三件事：**渠道抽象怎么设计**、**本地如何零配置演示完整支付链路**、**换成真实微信支付 / 支付宝需要改哪些配置和密钥**。
> 相关代码：
> - 渠道接口：`backend/src/modules/payment/payment-provider.ts`
> - Mock：`backend/src/modules/payment/providers/mock.provider.ts`
> - 微信支付 V3：`backend/src/modules/payment/providers/wechat.provider.ts`
> - 支付宝：`backend/src/modules/payment/providers/alipay.provider.ts`
> - 回调与幂等：`backend/src/modules/payment/payment.service.ts`（`handleNotify` / `settle`）
> - 前端收银台：`frontend/src/views/CheckoutView.vue`、`frontend/src/views/MockPayView.vue`、`frontend/src/components/PayDialog.vue`

## 1. 渠道抽象

三个渠道实现同一个接口，业务层（`PaymentService`）完全不知道渠道差异：

```ts
export interface PaymentProvider {
  readonly code: 'mock' | 'wechat' | 'alipay';
  readonly displayName: string;
  createPayment(input: CreatePaymentInput): Promise<ProviderCreateResult>;
  verifyNotify(input: NotifyInput): Promise<VerifiedNotify>;
  queryPayment(input: { outTradeNo: string }): Promise<QueryResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}
```

新增渠道只需实现该接口并在 `PaymentService` 注册表里加一行，下单、回调、退款、对账逻辑全部复用。

渠道选择由下单后的 `POST /api/payments/create { orderNo, provider }` 决定，支付流水表记录 `provider / trade_type / out_trade_no`，同一订单可以先后尝试不同渠道（失败流水保留可追溯）。

## 2. 本地演示（默认路径，零配置）

`WECHAT_PAY_MODE=sandbox`、`ALIPAY_MODE=sandbox`、`MOCK_PAY_SECRET` 默认值即可跑通：

1. 前端「我的订单 → 去支付」或 `PayDialog` → `POST /api/payments/create { provider: 'mock' }`；
2. 后端返回 `payParams.mockPayUrl` 与**完整回调报文** `mockNotifyBody`（含 HMAC-SHA256 签名）；
3. 前端跳到 `/#/pay/mock?outTradeNo=...`，点「确认支付」把报文原样 POST 回 `/api/payments/mock/notify`；
4. 后端 `verifyNotify` 校验字段、时间窗（默认 15 分钟）、`timingSafeEqual` 签名 → `settle()` 事务内幂等发货 → 返回 `granted` 明细；
5. 重复点「确认支付」会得到 `duplicate: true` 且 `granted: []` —— 这就是幂等演示。

也可以完全用命令行验证：

```bash
node scripts/smoke-payment.mjs
```

### Mock 回调签名算法（与 `mock.provider.ts` 一致）

```
canonical = ['mock', outTradeNo, amount, status, timestamp, nonce, providerTradeNo].join('\n')
signature = HMAC-SHA256(MOCK_PAY_SECRET, canonical).hex()
```

其中 `amount` 是保留两位小数的字符串（如 `"9.90"`），`timestamp` 是秒级时间戳字符串。

## 3. 微信支付 V3（JSAPI / Native）

### 3.1 已实现的能力

- 下单：`POST /v3/pay/transactions/jsapi` 报文组装，`Authorization: WECHATPAY2-SHA256-RSA2048` 签名头（商户私钥 RSA-SHA256）；
- 回调验签：校验 `Wechatpay-Timestamp` 时间窗（5 分钟）、`Wechatpay-Nonce`、`Wechatpay-Signature`（平台证书公钥验签）、`Wechatpay-Serial`；
- 回调解密：`resource.ciphertext` 用 **APIv3 Key + AES-256-GCM** 解密，得到 `out_trade_no / transaction_id / amount.total`；
- 应答：成功返回 `{"code":"SUCCESS","message":"成功"}`，失败返回 401 + `{"code":"FAIL"}`（渠道会重试）；
- 退款：`POST /v3/refund/domestic/refunds`；
- `WECHAT_PAY_MODE=sandbox` 时不发真实网络请求，但**签名、验签、解密全部真实执行**，便于本地演示与单元测试。

### 3.2 正式接入需要替换的配置

| 环境变量 | 当前示例值 | 替换为 |
| --- | --- | --- |
| `WECHAT_PAY_MODE` | `sandbox` | `live` |
| `WECHAT_APPID` | `wx_demo_appid` | 公众号/小程序 AppID |
| `WECHAT_MCHID` | `1900000000` | 微信支付商户号 |
| `WECHAT_SERIAL_NO` | 空 | 商户 API 证书序列号 |
| `WECHAT_API_V3_KEY` | 空 | 商户平台设置的 APIv3 密钥（32 字节） |
| `WECHAT_PRIVATE_KEY_PATH` | `./storage/sandbox/wechat_apiclient_key.pem` | 商户私钥 `apiclient_key.pem` 路径 |
| `WECHAT_PLATFORM_CERT_PATH` | `./storage/sandbox/wechat_platform_cert.pem` | 微信支付平台证书 `wechatpay_*.pem` 路径 |
| `WECHAT_NOTIFY_URL` | `http://localhost:3000/api/payments/wechat/notify` | **公网 https 地址**，如 `https://your-domain.com/api/payments/wechat/notify` |

注意：

- 回调地址必须是公网可达的 https，且不能带自定义鉴权（微信不带你的 JWT），所以该接口在代码里是 `@Public()` + `@RawResponse()`；
- 平台证书会轮换，生产建议做证书自动下载或定期更新文件；
- 私钥/证书放在 `storage/sandbox/` 或 `storage/certs/`，**已在 `.gitignore` 中排除**，不要提交到仓库；
- JSAPI 下单需要真实 `openid`（前端通过微信授权拿到后随 `POST /payments/create` 的 `openId` 传入），Native 扫码则用 `code_url` 生成二维码。

## 4. 支付宝（电脑网站支付 / 当面付）

### 4.1 已实现的能力

- 下单：组装 `alipay.trade.page.pay`（或当面付）公共参数与业务参数，`sign` 用商户私钥 **RSA2（SHA256withRSA）**；
- 回调验签：对异步通知参数做「剔除 `sign` / `sign_type` → 按 key 排序 → 拼接 `k=v&...`」后，用**支付宝公钥**验签，并校验 `app_id` 与配置一致；
- 应答：成功返回纯文本 `success`，失败返回 `fail`（支付宝会重试）；
- 退款：`alipay.trade.refund`；
- `ALIPAY_MODE=sandbox` 时同样不发网络请求，但签名与验签真实执行。

### 4.2 正式接入需要替换的配置

| 环境变量 | 当前示例值 | 替换为 |
| --- | --- | --- |
| `ALIPAY_MODE` | `sandbox` | `live` |
| `ALIPAY_APP_ID` | `2021000000000000` | 开放平台应用 AppID |
| `ALIPAY_GATEWAY` | `https://openapi.alipay.com/gateway.do` | 正式网关（沙箱用 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`） |
| `ALIPAY_PRIVATE_KEY_PATH` | `./storage/sandbox/alipay_app_private.pem` | 应用私钥路径 |
| `ALIPAY_PUBLIC_KEY_PATH` | `./storage/sandbox/alipay_platform_public.pem` | **支付宝公钥**路径（不是应用公钥） |
| `ALIPAY_NOTIFY_URL` | `http://localhost:3000/api/payments/alipay/notify` | 公网 https 地址 |

## 5. 回调处理与幂等的统一约定

三条回调路径共用同一套处理（`PaymentService.handleNotify`）：

1. `verifyNotify` 验签（失败 → `400/4001`，且不落库）；
2. 按 `out_trade_no` 查 `payment_transaction`（不存在 → `404/9002`）；
3. `amountEquals(a, b)` 校验金额（不一致 → `409/4003`，防止篡改）；
4. 非成功状态：流水记为 `failed`，返回「未发货」；
5. 成功：`settle()` 事务内先做状态 CAS（`pending → success`），命中 0 行即重复回调，直接成功应答；
6. 首次回调才执行 `grantForOrder`：充值 → 钱包入账（`biz_no = recharge:<orderNo>` 唯一兜底）、房间会员 → 发放 31/366 天权益、点播 → 永久权益；
7. 订单若已因超时关闭，会补记为已支付并备注「超时支付补单」。

所以「渠道重试 + 人工重复点击 + 并发回调」三种情况都只会发一次货。

## 6. 对账与退款

- **对账**：`POST /api/admin/reconciliation { billDate, provider }`，比对本地成功流水与渠道账单（沙箱下渠道侧为模拟数据），把结果写入 `reconciliation_log`（唯一键 `bill_date + provider`，重复执行覆盖），返回 `localCount / channelCount / totalLocal / totalChannel / diffCount / diffs`；
- **每日自动对账**：`JobsService` 每天 02:30 跑一次（`RECONCILIATION_CRON`）；
- **退款**：`POST /api/payments/refund/:orderNo`（仅管理员），渠道退款成功后在事务内把订单置 `refunded`、写 `refund_record`、支付流水置 `refunded`，并按业务类型回收权益或扣回充值余额；余额不足扣回时返回 `409/5001`。

## 7. 切换真实渠道的步骤清单

1. 在微信商户平台 / 支付宝开放平台创建应用，拿到 AppID、商户号、密钥与证书；
2. 把证书文件放到 `storage/certs/`（已被 `.gitignore` 排除），更新 `.env` 里的 6~8 个变量（见上表）；
3. 把 `WECHAT_PAY_MODE` / `ALIPAY_MODE` 改成 `live`；
4. 回调地址配置成公网 https 域名，并在 nginx 上放行 `POST /api/payments/*/notify`；
5. 用真实小额订单跑一次「下单 → 支付 → 回调 → 权益到账 → 退款」，核对 `payment_transaction` 与 `balance_transaction`；
6. 打开 `DB_LOG_SQL=true` 或看服务日志确认回调只处理一次（第二次应返回 `duplicate: true`）。
