import { ApiEnvelope, TestContext } from './helpers/test-app';
import { DanmakuService } from '../src/modules/danmaku/danmaku.service';
import type { AuthUser } from '../src/common/decorators/auth.decorators';

let ctx: TestContext;
let viewerToken: string;
let viewer2Token: string;
let adminToken: string;
let viewerId: number;
let viewer2Id: number;
let roomId: number;
let gifts: any[] = [];

function asUser(userId: number, username: string, role: 'viewer' | 'anchor' | 'admin' = 'viewer'): AuthUser {
  return { id: userId, username, role, jti: `test-${userId}` } as AuthUser;
}

beforeAll(async () => {
  ctx = await TestContext.create('danmaku');
  viewerToken = await ctx.token('viewer');
  viewer2Token = await ctx.token('viewer2');
  adminToken = await ctx.token('admin');

  const viewer = await ctx.db('user').where({ username: 'viewer' }).first();
  const viewer2 = await ctx.db('user').where({ username: 'viewer2' }).first();
  viewerId = Number(viewer.id);
  viewer2Id = Number(viewer2.id);

  const room = await ctx.db('live_room').where({ stream_key: 'demo-room-1' }).first();
  roomId = Number(room.id);

  gifts = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url('/gifts')));
});

afterAll(async () => {
  await ctx.close();
});

describe('弹幕：内容审核 / 频控 / 历史补屏 / 管理端下架', () => {
  it('历史弹幕可匿名拉取，返回种子弹幕并保持时间正序', async () => {
    const list = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url(`/rooms/${roomId}/danmaku`)));
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(4);
    const ids = list.map((item) => item.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(list[0]).toHaveProperty('nickname');
    expect(list[0]).toHaveProperty('content');
    expect(list[0]).toHaveProperty('color');
  });

  it('拒发词直接拒绝：命中「赌博」抛业务异常', () => {
    const service = ctx.app.get(DanmakuService);
    expect(() => service.inspect('今晚一起去赌博网站看看')).toThrow(/违规词/);
    expect(() => service.inspect('   ')).toThrow();
    expect(() => service.inspect('x'.repeat(61))).toThrow(/60/);
  });

  it('屏蔽词被替换为 *，并标记 masked', () => {
    const service = ctx.app.get(DanmakuService);
    const result = service.inspect('主播加微信 有福利');
    expect(result.masked).toBe(true);
    expect(result.content).not.toContain('加微信');
    expect(result.content).toContain('*');
  });

  it('发送弹幕成功：入库并进入历史，颜色非法时回退为白色', async () => {
    const service = ctx.app.get(DanmakuService);
    const sent = await service.send(asUser(viewerId, 'viewer'), roomId, '这首歌太好听了，主播加油', '#00ffcc');
    expect(sent.danmaku.content).toContain('主播加油');
    expect(sent.masked).toBe(false);
    expect(sent.remaining).toBeLessThanOrEqual(4);

    const list = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url(`/rooms/${roomId}/danmaku`)));
    expect(list.some((item) => item.id === sent.danmaku.id)).toBe(true);

    const fallback = await service.send(asUser(viewerId, 'viewer'), roomId, '颜色测试', 'javascript:alert(1)');
    expect(fallback.danmaku.color).toBe('#ffffff');
  });

  it('频控：5 秒窗口内第 6 条被拒绝（7002 / 429）', async () => {
    const service = ctx.app.get(DanmakuService);
    const user = asUser(viewer2Id, 'viewer2');
    for (let i = 0; i < 5; i += 1) {
      await service.send(user, roomId, `连发测试 ${i}`);
    }
    let caught: any;
    try {
      await service.send(user, roomId, '第六条应该被频率限制');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeTruthy();
    expect(caught.getStatus()).toBe(429);
    expect(caught.message).toContain('最多发送');
  });

  it('管理员下架违规弹幕：历史列表不再返回', async () => {
    const before = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url(`/rooms/${roomId}/danmaku`)));
    const target = before[before.length - 1];
    const hidden = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/admin/danmaku/${target.id}/hide`))
        .set('Authorization', `Bearer ${adminToken}`),
      201,
    );
    expect(hidden.status).toBe('hidden');

    const after = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url(`/rooms/${roomId}/danmaku`)));
    expect(after.some((item) => item.id === target.id)).toBe(false);
  });
});

describe('礼物：余额扣减 / requestId 幂等 / 余额不足 / 榜单', () => {
  it('送礼成功：余额 200 → 199，写入送礼记录与资金流水', async () => {
    const heart = gifts.find((item: any) => item.name === '小心心');
    expect(heart.price).toBe(1);

    const sent = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/gifts/send'))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ roomId, giftId: heart.id, count: 1, requestId: 'gift-req-0001' }),
      201,
    );
    expect(sent.giftName).toBe('小心心');
    expect(sent.amount).toBe(1);
    expect(sent.balance).toBe(199);
    expect(sent.idempotent).toBe(false);

    const wallet = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/wallet/me')).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(wallet.balance).toBe(199);
    expect(wallet.totalConsume).toBe(1);

    const ledger = await ctx.db('balance_transaction').where({ biz_no: 'gift:gift-req-0001' }).first();
    expect(ledger).toBeTruthy();
    expect(Number(ledger.amount)).toBe(-1);
  });

  it('同一 requestId 重复送礼：不重复扣款，返回 idempotent=true', async () => {
    const heart = gifts.find((item: any) => item.name === '小心心');
    const replay = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/gifts/send'))
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ roomId, giftId: heart.id, count: 1, requestId: 'gift-req-0001' }),
      201,
    );
    expect(replay.idempotent).toBe(true);

    const wallet = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/wallet/me')).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(wallet.balance).toBe(199);
    const rows = await ctx.db('gift_record').where({ request_id: 'gift-req-0001' });
    expect(rows.length).toBe(1);
  });

  it('余额不足时送礼被拒绝（409 / 5001）', async () => {
    const crown = gifts.find((item: any) => item.name === '嘉年华');
    expect(crown.price).toBe(520);
    const res = await ctx.request()
      .post(ctx.url('/gifts/send'))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ roomId, giftId: crown.id, count: 1, requestId: 'gift-req-rich-1' });
    expect(res.status).toBe(409);
    expect((res.body as ApiEnvelope).code).toBe(5001);
  });

  it('礼物榜单按金额聚合返回昵称与总额', async () => {
    const list = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url(`/gifts/leaderboard/${roomId}`)));
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toHaveProperty('nickname');
    expect(list[0]).toHaveProperty('totalAmount');
    expect(list[0]).toHaveProperty('giftCount');
  });

  it('礼物下架后不可赠送（404）', async () => {
    const heart = gifts.find((item: any) => item.name === '小心心');
    await ctx.db('gift').where({ id: heart.id }).update({ enabled: false });
    const res = await ctx.request()
      .post(ctx.url('/gifts/send'))
      .set('Authorization', `Bearer ${viewer2Token}`)
      .send({ roomId, giftId: heart.id, count: 1, requestId: 'gift-req-off-01' });
    expect(res.status).toBe(404);
    expect((res.body as ApiEnvelope).code).toBe(9002);
    await ctx.db('gift').where({ id: heart.id }).update({ enabled: true });
  });
});
