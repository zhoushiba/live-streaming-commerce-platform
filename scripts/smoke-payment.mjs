#!/usr/bin/env node
/**
 * 支付链路冒烟脚本（Mock 渠道为主演示路径）
 * ---------------------------------------------------------------------------
 * 覆盖：注册 → 登录 → 选付费直播间 → 下单（幂等复放）→ 发起 Mock 支付
 *       → 重复两次回调（验证幂等）→ 权益到账 → 查我的订单 → 篡改签名被拒
 *
 * 用法：
 *   node scripts/smoke-payment.mjs                # 默认 http://127.0.0.1:3000/api
 *   BASE=http://127.0.0.1:3000/api node scripts/smoke-payment.mjs
 *
 * 为什么用 Node 而不是 bash+curl：
 *   跨平台（Windows PowerShell / Linux / macOS 都能跑），且不需要 jq。
 *   每个步骤都会打印等价的 curl 命令，方便在 README/答辩里逐条复现。
 */

const BASE = process.env.BASE ?? 'http://127.0.0.1:3000/api';

let failures = 0;
const results = [];

const c = {
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function banner(text) {
  console.log(`\n${c.cyan('▶')} ${c.bold(text)}`);
}

/** 打印真实请求与响应，返回解析后的 JSON（保留原始报文用于断言） */
async function call(method, path, { token, body, headers, expectStatus } = {}) {
  const url = `${BASE}${path}`;
  const init = { method, headers: { ...(headers ?? {}) } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const curlParts = [`curl -s -X ${method} \\`, `  '${url}' \\`];
  if (token) curlParts.push(`  -H 'Authorization: Bearer ${token}' \\`);
  if (body !== undefined) curlParts.push(`  -H 'Content-Type: application/json' \\`, `  -d '${typeof body === 'string' ? body : JSON.stringify(body)}'`);
  const curl = curlParts.join('\n').replace(/ \\\n\s*$/, '');
  console.log(c.gray(curl));

  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  console.log(c.gray(`HTTP ${res.status}`), JSON.stringify(json, null, 0).slice(0, 900));

  const entry = { method, path, status: res.status, body: json };
  results.push(entry);
  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(`${method} ${path} 期望 HTTP ${expectStatus}，实际 ${res.status}：${text.slice(0, 300)}`);
  }
  return { status: res.status, json, text };
}

function assert(cond, message) {
  if (cond) {
    console.log(c.green(`  ✓ ${message}`));
  } else {
    failures += 1;
    console.log(c.red(`  ✗ ${message}`));
  }
}

async function main() {
  const stamp = Date.now().toString(36);
  const username = `smoke_${stamp}`;
  const password = 'Smoke123456';

  console.log(c.bold(`\n=== 支付链路冒烟：${BASE} ===`));

  // 1. 注册
  banner('1. 注册（viewer）');
  const reg = await call('POST', '/auth/register', {
    body: { username, password, nickname: '冒烟测试用户', role: 'viewer' },
    expectStatus: 201,
  });
  assert(reg.json?.data?.user?.username === username, '注册成功并返回用户名');
  assert(!reg.json?.data?.user?.passwordHash, '响应中不含密码哈希');

  // 2. 登录
  banner('2. 登录 → Access + Refresh');
  const login = await call('POST', '/auth/login', { body: { username, password }, expectStatus: 201 });
  const token = login.json?.data?.accessToken;
  const refreshToken = login.json?.data?.refreshToken;
  assert(typeof token === 'string' && token.split('.').length === 3, '拿到 JWT Access Token');
  assert(typeof refreshToken === 'string', '拿到 Refresh Token');

  // 额外证据：JWT 载荷结构
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  console.log(c.gray(`  JWT payload: ${JSON.stringify(payload)}`));
  assert(payload.type === 'access' && payload.iss === 'live-commerce', 'JWT 载荷含 type=access / issuer');

  // 3. 选一个付费直播间
  banner('3. 挑选付费直播间');
  const rooms = await call('GET', '/rooms?page=1&pageSize=20', { expectStatus: 200 });
  const paidRoom = rooms.json?.data?.list?.find((r) => r.priceType !== 'free' && Number(r.price) > 0);
  assert(Boolean(paidRoom), `找到付费直播间：#${paidRoom?.id} ${paidRoom?.title} ¥${paidRoom?.price}/${paidRoom?.priceType}`);

  // 4. 下单 + 幂等复放
  banner('4. 下单（同一 idempotencyKey 复放一次）');
  const idempotencyKey = `smoke-${stamp}`;
  const orderBody = { bizType: 'room', targetId: paidRoom.id, idempotencyKey };
  const order1 = await call('POST', '/orders', { token, body: orderBody, expectStatus: 201 });
  const orderNo = order1.json?.data?.orderNo;
  assert(typeof orderNo === 'string' && orderNo.startsWith('LO'), `订单号生成：${orderNo}`);
  assert(order1.json?.data?.amount === paidRoom.price, `金额由服务端定价：${order1.json?.data?.amount}`);

  const order2 = await call('POST', '/orders', { token, body: orderBody, expectStatus: 201 });
  assert(order2.json?.data?.orderNo === orderNo, '同幂等键返回同一订单号（未重复建单）');
  assert(order2.json?.data?.idempotent === true, '幂等标记 idempotent=true');

  // 5. 发起 Mock 支付
  banner('5. 发起 Mock 支付（返回可直接回调的报文）');
  const pay = await call('POST', '/payments/create', {
    token,
    body: { orderNo, provider: 'mock' },
    expectStatus: 200,
  });
  const paid = pay.json?.data ?? {};
  const notifyBody = paid.mockNotifyBody;
  assert(paid.provider === 'mock', `渠道=mock，outTradeNo=${paid.outTradeNo}`);
  assert(Boolean(notifyBody?.signature), 'Mock 回调报文自带 HMAC-SHA256 签名');

  // 6. 第一次回调：真实发货
  banner('6. 第 1 次回调（应当结算并发权益）');
  const n1 = await call('POST', '/payments/mock/notify', { body: notifyBody, expectStatus: 200 });
  assert(n1.json?.data?.success === true, '回调受理成功');
  assert(n1.json?.data?.duplicate === false, 'duplicate=false（首次结算）');
  assert(Array.isArray(n1.json?.data?.granted) && n1.json.data.granted.length > 0, `发放权益：${JSON.stringify(n1.json?.data?.granted)}`);

  // 7. 第二次回调：幂等
  banner('7. 第 2 次回调（同一报文重放，必须幂等）');
  const n2 = await call('POST', '/payments/mock/notify', { body: notifyBody, expectStatus: 200 });
  assert(n2.json?.data?.duplicate === true, 'duplicate=true（识别为重复回调）');
  assert((n2.json?.data?.granted ?? []).length === 0, '未重复发货（granted 为空）');
  console.log(c.gray(`  message: ${n2.json?.data?.message}`));

  // 8. 篡改签名 → 拒绝
  banner('8. 篡改签名回调（必须验签失败）');
  const tampered = { ...notifyBody, amount: '0.01' };
  const bad = await call('POST', '/payments/mock/notify', { body: tampered });
  assert(bad.status === 400, `验签失败返回 400，业务码 ${bad.json?.code}`);

  // 9. 权益到账
  banner('9. 查我的权益');
  const ents = await call('GET', '/entitlements/mine', { token, expectStatus: 200 });
  const entList = ents.json?.data?.list ?? ents.json?.data ?? [];
  const hit = Array.isArray(entList) ? entList.find((e) => e.targetType === 'room' && Number(e.targetId) === paidRoom.id) : null;
  assert(Boolean(hit), `权益已到账：targetType=room targetId=${paidRoom.id} expireAt=${hit?.expireAt ?? '永久'}`);

  // 10. 我的订单
  banner('10. 查我的订单');
  const orders = await call('GET', '/orders?page=1&pageSize=10', { token, expectStatus: 200 });
  const mine = orders.json?.data?.list?.find((o) => o.orderNo === orderNo);
  assert(mine?.status === 'paid', `订单状态=paid，支付渠道=${mine?.payProvider}`);

  // 11. 余额与钱包
  banner('11. 钱包流水（本次为内容购买，余额应不变）');
  const wallet = await call('GET', '/wallet/me', { token, expectStatus: 200 });
  assert(typeof wallet.json?.data?.balance === 'number', `钱包余额：¥${wallet.json?.data?.balance}`);

  // 12. 刷新令牌轮换
  banner('12. Refresh Token 轮换（旧 token 立即失效）');
  const refreshed = await call('POST', '/auth/refresh', { body: { refreshToken }, expectStatus: 201 });
  const newAccess = refreshed.json?.data?.accessToken;
  assert(typeof newAccess === 'string' && newAccess !== token, '拿到新的 Access Token');
  const reuse = await call('POST', '/auth/refresh', { body: { refreshToken } });
  assert(reuse.status === 401, `旧 Refresh Token 复用被拒：HTTP ${reuse.status} / code ${reuse.json?.code}`);

  console.log(`\n${failures === 0 ? c.green('=== SMOKE PASSED ===') : c.red(`=== SMOKE FAILED (${failures}) ===`)}`);
  console.log(c.gray(`共 ${results.length} 个请求，失败断言 ${failures} 个`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(c.red(`\n冒烟中断：${err.message}`));
  process.exit(1);
});
