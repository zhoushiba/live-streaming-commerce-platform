import { ApiEnvelope, TestContext } from './helpers/test-app';

let ctx: TestContext;
let viewerToken: string;
let viewer2Token: string;
let paidRoomId: number;
let freeRoomId: number;
let freeEpisodeId: number;

beforeAll(async () => {
  ctx = await TestContext.create('order');
  viewerToken = await ctx.token('viewer');
  viewer2Token = await ctx.token('viewer2');

  const paidRoom = await ctx.db('live_room').where({ stream_key: 'demo-room-1' }).first();
  const freeRoom = await ctx.db('live_room').where({ stream_key: 'demo-room-2' }).first();
  paidRoomId = Number(paidRoom.id);
  freeRoomId = Number(freeRoom.id);

  const freeEpisode = await ctx.db('video_episode').where({ free: true }).first();
  freeEpisodeId = Number(freeEpisode.id);
});

afterAll(async () => {
  await ctx.close();
});

describe('下单：服务端定价 / 幂等键 / 订单状态机', () => {
  it('充值下单成功：pending + 15 分钟有效期', async () => {
    const data = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/orders'))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ bizType: 'recharge', amount: 88, idempotencyKey: 'recharge-key-0001' }),
      201,
    );
    expect(data.orderNo).toBeTruthy();
    expect(data.bizType).toBe('recharge');
    expect(data.amount).toBe(88);
    expect(data.status).toBe('pending');
    expect(data.idempotent).toBe(false);
    const ttlMinutes = Math.round((new Date(data.expireAt).getTime() - Date.now()) / 60000);
    expect(ttlMinutes).toBe(15);
  });

  it('同一幂等键重复提交：返回同一订单且标记 idempotent', async () => {
    const first = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/orders'))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ bizType: 'recharge', amount: 88, idempotencyKey: 'recharge-key-0001' }),
    );
    const second = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/orders'))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ bizType: 'recharge', amount: 88, idempotencyKey: 'recharge-key-0001' }),
      201,
    );
    expect(second.orderNo).toBe(first.orderNo);
    expect(second.idempotent).toBe(true);
    const rows = await ctx.db('orders').where({ idempotency_key: 'recharge-key-0001' });
    expect(rows.length).toBe(1);
  });

  it('幂等键已被其他用户占用 → 409 / 3002', async () => {
    const res = await ctx.request()
      .post(ctx.url('/orders'))
      .set('Authorization', `Bearer ${viewer2Token}`)
      .send({ bizType: 'recharge', amount: 50, idempotencyKey: 'recharge-key-0001' });
    expect(res.status).toBe(409);
    expect((res.body as ApiEnvelope).code).toBe(3002);
  });

  it('付费直播间：金额来自服务端房间定价，而非客户端传值', async () => {
    const data = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/orders'))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ bizType: 'room', targetId: paidRoomId, amount: 5, idempotencyKey: 'room-order-0001' }),
      201,
    );
    expect(data.amount).toBe(9.9);
    expect(data.title).toContain('直播间会员');
  });

  it('免费直播间无需下单 → 400 / 9010', async () => {
    const res = await ctx.request()
      .post(ctx.url('/orders'))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ bizType: 'room', targetId: freeRoomId, idempotencyKey: 'free-room-0001' });
    expect(res.status).toBe(400);
    expect((res.body as ApiEnvelope).code).toBe(9010);
    expect((res.body as ApiEnvelope).message).toContain('免费');
  });

  it('免费剧集无需下单 → 400 / 9010', async () => {
    const res = await ctx.request()
      .post(ctx.url('/orders'))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ bizType: 'video', targetId: freeEpisodeId, idempotencyKey: 'free-episode-01' });
    expect(res.status).toBe(400);
    expect((res.body as ApiEnvelope).code).toBe(9010);
  });

  it('未登录不能下单（401 / 1003）', async () => {
    const res = await ctx.request()
      .post(ctx.url('/orders'))
      .send({ bizType: 'recharge', amount: 10, idempotencyKey: 'anonymous-0001' });
    expect(res.status).toBe(401);
    expect((res.body as ApiEnvelope).code).toBe(1003);
  });

  it('我的订单列表：分页 + 状态过滤', async () => {
    const all = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/orders')).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(all.list[0]).toHaveProperty('status');
    expect(all.list[0]).toHaveProperty('title');
    expect(all.list[0].title.length).toBeGreaterThan(0);

    const firstPage = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url('/orders'))
        .query({ page: 1, pageSize: 1 })
        .set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(firstPage.list.length).toBe(1);
    expect(firstPage.total).toBe(all.total);
    expect(firstPage.totalPages).toBeGreaterThanOrEqual(2);

    const pending = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url('/orders'))
        .query({ status: 'pending' })
        .set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(pending.list.every((item: any) => item.status === 'pending')).toBe(true);
  });

  it('订单详情包含条目；非本人不可查看（403）', async () => {
    const list = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/orders')).set('Authorization', `Bearer ${viewerToken}`),
    );
    const orderNo = list.list[0].orderNo;
    const detail = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url(`/orders/${orderNo}`)).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(detail.orderNo).toBe(orderNo);
    expect(Array.isArray(detail.items)).toBe(true);
    expect(detail.items.length).toBe(1);
    expect(detail.payment).toBeNull();
    expect(detail.entitlement).toBeNull();

    const forbidden = await ctx.request()
      .get(ctx.url(`/orders/${orderNo}`))
      .set('Authorization', `Bearer ${viewer2Token}`);
    expect(forbidden.status).toBe(403);
    expect((forbidden.body as ApiEnvelope).code).toBe(1006);
  });

  it('取消待支付订单：pending → closed；重复取消被拒绝（409 / 3002）', async () => {
    const created = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/orders'))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ bizType: 'recharge', amount: 20, idempotencyKey: 'cancel-me-0001' }),
      201,
    );
    const cancelled = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/orders/${created.orderNo}/cancel`))
        .set('Authorization', `Bearer ${viewerToken}`),
      201,
    );
    expect(cancelled.status).toBe('closed');

    const again = await ctx.request()
      .post(ctx.url(`/orders/${created.orderNo}/cancel`))
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(again.status).toBe(409);
    expect((again.body as ApiEnvelope).code).toBe(3002);
    expect((again.body as ApiEnvelope).message).toContain('待支付');
  });
});
