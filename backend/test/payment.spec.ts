import { createHmac, randomBytes } from 'node:crypto';
import { ApiEnvelope, TestContext } from './helpers/test-app';

let ctx: TestContext;
let viewerToken: string;
let adminToken: string;
let paidRoomId: number;
let paidEpisodeId: number;
let paidVideoId: number;

interface MockBodyInput {
  status?: string;
  timestamp?: string;
  nonce?: string;
  providerTradeNo?: string;
  /** 传入错误密钥可模拟伪造签名 */
  secret?: string;
}

/** 按 mock 渠道的签名规则构造回调体（与 backend/src/modules/payment/providers/mock.provider.ts 一致） */
function buildMockNotifyBody(outTradeNo: string, amount: string, input: MockBodyInput = {}) {
  const status = input.status ?? 'success';
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomBytes(8).toString('hex');
  const providerTradeNo = input.providerTradeNo ?? `MOCKTN${Date.now()}`;
  const canonical = ['mock', outTradeNo, amount, status, timestamp, nonce, providerTradeNo].join('\n');
  const signature = createHmac('sha256', input.secret ?? ctx.config.pay.mock.secret).update(canonical).digest('hex');
  return { outTradeNo, amount, status, timestamp, nonce, providerTradeNo, signature };
}

async function placeOrder(body: Record<string, unknown>): Promise<any> {
  const res = await ctx.request().post(ctx.url('/orders')).set('Authorization', `Bearer ${viewerToken}`).send(body);
  return TestContext.unwrap<any>(res, 201);
}

/** 下单 → 发起 mock 支付 → 回调成功，返回三段结果 */
async function payOrder(body: Record<string, unknown>) {
  const order = await placeOrder(body);
  const created = TestContext.unwrap<any>(
    await ctx.request()
      .post(ctx.url('/payments/create'))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ orderNo: order.orderNo, provider: 'mock' }),
  );
  const notify = TestContext.unwrap<any>(
    await ctx.request().post(ctx.url('/payments/mock/notify')).send(created.mockNotifyBody),
    200,
  );
  return { order, created, notify };
}

beforeAll(async () => {
  ctx = await TestContext.create('payment');
  viewerToken = await ctx.token('viewer');
  adminToken = await ctx.token('admin');

  const room = await ctx.db('live_room').where({ stream_key: 'demo-room-1' }).first();
  paidRoomId = Number(room.id);
  const episode = await ctx.db('video_episode').where({ free: false }).first();
  paidEpisodeId = Number(episode.id);
  paidVideoId = Number(episode.video_id);
});

afterAll(async () => {
  await ctx.close();
});

describe('支付渠道与充值链路（下单 → 支付 → 回调 → 重复回调幂等）', () => {
  it('支付渠道列表可匿名读取，mock 为默认渠道', async () => {
    const data = TestContext.unwrap<any>(await ctx.request().get(ctx.url('/payments/providers')));
    expect(data.providers.map((item: any) => item.code)).toEqual(expect.arrayContaining(['mock', 'wechat', 'alipay']));
    expect(data.default).toBe('mock');
  });

  it('充值全链路：发起支付拿到 mock 回调体，回调成功后余额 200 → 300', async () => {
    const { order, created, notify } = await payOrder({
      bizType: 'recharge',
      amount: 100,
      idempotencyKey: 'pay-topup-0001',
    });

    expect(order.amount).toBe(100);
    expect(created.provider).toBe('mock');
    expect(created.outTradeNo).toBeTruthy();
    expect(created.payParams.mockPayUrl).toContain('/pay/mock');
    expect(created.mockNotifyBody.signature).toHaveLength(64);
    expect(created.sandboxNotice).toBeTruthy();

    expect(notify.success).toBe(true);
    expect(notify.duplicate).toBe(false);
    expect(notify.granted).toEqual(['wallet:+100.00']);

    const wallet = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/wallet/me')).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(wallet.balance).toBe(300);

    const tx = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url(`/payments/${created.outTradeNo}`)).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(tx.status).toBe('success');
    expect(tx.orderNo).toBe(order.orderNo);
  });

  it('重复回调同一笔支付：duplicate=true，钱包不重复入账（幂等核心）', async () => {
    const created = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/wallet/transactions')).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(created.total).toBeGreaterThanOrEqual(1);

    const [rechargeTx] = await ctx.db('payment_transaction').where({ status: 'success' }).limit(1);
    const replay = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/payments/mock/notify'))
        .send(buildMockNotifyBody(rechargeTx.out_trade_no, Number(rechargeTx.amount).toFixed(2), { providerTradeNo: rechargeTx.provider_trade_no })),
      200,
    );
    expect(replay.duplicate).toBe(true);
    expect(replay.granted).toEqual([]);

    const wallet = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/wallet/me')).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(wallet.balance).toBe(300);

    const rows = await ctx.db('balance_transaction').where({ biz_no: `recharge:${rechargeTx.order_no}` });
    expect(rows.length).toBe(1);
  });

  it('回调签名错误被拒绝（400 / 4001）', async () => {
    const { created } = await payOrder({ bizType: 'recharge', amount: 10, idempotencyKey: 'pay-sign-bad-01' });
    const body = { ...created.mockNotifyBody, signature: 'f'.repeat(64) };
    const res = await ctx.request().post(ctx.url('/payments/mock/notify')).send(body);
    expect(res.status).toBe(400);
    expect((res.body as ApiEnvelope).code).toBe(4001);
  });

  it('回调时间戳超出窗口被拒绝（400 / 4001）', async () => {
    const { created } = await payOrder({ bizType: 'recharge', amount: 10, idempotencyKey: 'pay-ts-bad-0001' });
    const body = buildMockNotifyBody(created.outTradeNo, '10.00', {
      timestamp: String(Math.floor(Date.now() / 1000) - 7200),
    });
    const res = await ctx.request().post(ctx.url('/payments/mock/notify')).send(body);
    expect(res.status).toBe(400);
    expect((res.body as ApiEnvelope).code).toBe(4001);
  });

  it('回调金额与订单不一致被拒绝（409 / 4003）', async () => {
    const { created } = await payOrder({ bizType: 'recharge', amount: 20, idempotencyKey: 'pay-amount-bad' });
    const body = buildMockNotifyBody(created.outTradeNo, '0.01');
    const res = await ctx.request().post(ctx.url('/payments/mock/notify')).send(body);
    expect(res.status).toBe(409);
    expect((res.body as ApiEnvelope).code).toBe(4003);
  });

  it('已支付订单不能重复发起支付（409 / 3002）', async () => {
    const paid = await ctx.db('orders').where({ status: 'paid' }).first();
    const res = await ctx.request()
      .post(ctx.url('/payments/create'))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ orderNo: paid.order_no, provider: 'mock' });
    expect(res.status).toBe(409);
    expect((res.body as ApiEnvelope).code).toBe(3002);
  });

  it('超时订单不可支付，并自动关单（409 / 3003）', async () => {
    const order = await placeOrder({ bizType: 'recharge', amount: 30, idempotencyKey: 'pay-timeout-0001' });
    await ctx.db('orders')
      .where({ order_no: order.orderNo })
      .update({ expire_at: new Date(Date.now() - 60000) });

    const res = await ctx.request()
      .post(ctx.url('/payments/create'))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ orderNo: order.orderNo, provider: 'mock' });
    expect(res.status).toBe(409);
    expect((res.body as ApiEnvelope).code).toBe(3003);

    const row = await ctx.db('orders').where({ order_no: order.orderNo }).first();
    expect(row.status).toBe('closed');
  });
});

describe('权益发放：直播间会员充值 / 点播单片购买 / 退款回收', () => {
  it('购买付费直播间：发放 31 天会员权益并解锁播放地址', async () => {
    const { order, notify } = await payOrder({
      bizType: 'room',
      targetId: paidRoomId,
      idempotencyKey: 'pay-room-first-1',
    });
    expect(order.amount).toBe(9.9);
    expect(notify.success).toBe(true);
    expect(notify.granted).toEqual([`room:${paidRoomId}+31d`]);

    const entitlements = TestContext.unwrap<any[]>(
      await ctx.request().get(ctx.url('/entitlements/mine')).set('Authorization', `Bearer ${viewerToken}`),
    );
    const roomEntitlement = entitlements.find((item: any) => item.targetType === 'room' && item.targetId === paidRoomId);
    expect(roomEntitlement).toBeTruthy();
    expect(roomEntitlement.active).toBe(true);
    const days = Math.round((new Date(roomEntitlement.expireAt).getTime() - Date.now()) / 86400000);
    expect(days).toBe(31); // 31 天（向下取整允许 1 天误差）

    const play = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url(`/streams/${paidRoomId}/play-info`))
        .set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(play.locked).toBe(false);
    expect(play.mode).toBe('demo');
    expect(play.sources.length).toBe(2);
  });

  it('再次购买同一会员：有效期在原到期时间上顺延 31 天', async () => {
    const before = TestContext.unwrap<any[]>(
      await ctx.request().get(ctx.url('/entitlements/mine')).set('Authorization', `Bearer ${viewerToken}`),
    ).find((item: any) => item.targetType === 'room' && item.targetId === paidRoomId);

    const { notify } = await payOrder({
      bizType: 'room',
      targetId: paidRoomId,
      idempotencyKey: 'pay-room-second',
    });
    expect(notify.granted).toEqual([`room:${paidRoomId}+31d`]);

    const after = TestContext.unwrap<any[]>(
      await ctx.request().get(ctx.url('/entitlements/mine')).set('Authorization', `Bearer ${viewerToken}`),
    ).find((item: any) => item.targetType === 'room' && item.targetId === paidRoomId);

    const deltaDays =
      (new Date(after.expireAt).getTime() - new Date(before.expireAt).getTime()) / (24 * 60 * 60 * 1000);
    expect(deltaDays).toBeGreaterThan(30.9);
    expect(deltaDays).toBeLessThan(31.1);
  });

  it('购买点播剧集：解锁播放地址，未购买前不下发地址', async () => {
    const lockedDetail = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url(`/videos/${paidVideoId}`)).set('Authorization', `Bearer ${viewerToken}`),
    );
    const lockedEpisode = lockedDetail.episodes.find((item: any) => item.id === paidEpisodeId);
    expect(lockedEpisode.locked).toBe(true);
    expect(lockedEpisode.playUrl).toBeNull();

    const { notify } = await payOrder({
      bizType: 'video',
      targetId: paidEpisodeId,
      idempotencyKey: 'pay-video-0001',
    });
    expect(notify.granted).toEqual([`video:${paidEpisodeId}(永久)`]);

    const detail = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url(`/videos/${paidVideoId}`)).set('Authorization', `Bearer ${viewerToken}`),
    );
    const unlocked = detail.episodes.find((item: any) => item.id === paidEpisodeId);
    expect(unlocked.locked).toBe(false);
    expect(unlocked.playUrl).toBeTruthy();

    const play = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/videos/${paidVideoId}/episodes/${paidEpisodeId}/play`))
        .set('Authorization', `Bearer ${viewerToken}`),
      201,
    );
    expect(play.locked).toBe(false);
    expect(['hls', 'flv']).toContain(play.protocol);
    expect(play.playUrl).toBeTruthy();
  });

  it('管理员退款：订单转 refunded、权益回收、播放重新上锁', async () => {
    const order = await ctx.db('orders').where({ biz_type: 'video', status: 'paid' }).first();
    const refunded = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/payments/refund/${order.order_no}`))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: '用户申请退款（测试）' }),
      200,
    );
    expect(refunded.status).toBe('success');
    expect(refunded.refundNo).toBeTruthy();

    const detail = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url(`/orders/${order.order_no}`)).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(detail.status).toBe('refunded');

    const entitlements = TestContext.unwrap<any[]>(
      await ctx.request().get(ctx.url('/entitlements/mine')).set('Authorization', `Bearer ${viewerToken}`),
    );
    const revoked = entitlements.find((item: any) => item.targetType === 'video' && item.targetId === paidEpisodeId);
    expect(revoked.status).toBe('revoked');
    expect(revoked.active).toBe(false);

    const play = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/videos/${paidVideoId}/episodes/${paidEpisodeId}/play`))
        .set('Authorization', `Bearer ${viewerToken}`),
      201,
    );
    expect(play.locked).toBe(true);
  });

  it('管理员触发对账并查询对账记录', async () => {
    const result = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/admin/reconciliation'))
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ billDate: '2026-11-20', provider: 'mock' }),
      201,
    );
    expect(result.provider).toBe('mock');
    expect(result.billDate).toBe('2026-11-20');
    expect(typeof result.localCount).toBe('number');
    expect(typeof result.diffCount).toBe('number');

    const list = TestContext.unwrap<any[]>(
      await ctx.request().get(ctx.url('/admin/reconciliation')).set('Authorization', `Bearer ${adminToken}`),
    );
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].provider).toBe('mock');
  });
});
