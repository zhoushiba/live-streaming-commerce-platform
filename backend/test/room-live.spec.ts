import { ApiEnvelope, TestContext } from './helpers/test-app';

let ctx: TestContext;
let anchorToken: string;
let viewerToken: string;
let adminToken: string;
let roomId: Record<string, number> = {};
let idleRoomId: number;

async function roomIdByKey(key: string): Promise<number> {
  const row = await ctx.db('live_room').where({ stream_key: key }).first();
  if (!row) throw new Error(`seed 直播间缺失：${key}`);
  return Number(row.id);
}

beforeAll(async () => {
  ctx = await TestContext.create('room');
  anchorToken = await ctx.token('anchor');
  viewerToken = await ctx.token('viewer');
  adminToken = await ctx.token('admin');
  roomId = {
    paidLiving: await roomIdByKey('demo-room-1'), // 深夜电台 · 治愈系钢琴，living，monthly 9.9
    freeLiving: await roomIdByKey('demo-room-2'), // 峡谷上分实录，living，free
    idleFree: await roomIdByKey('demo-room-3'), // 前端工程化实战，idle，free
    paidLiving2: await roomIdByKey('demo-room-4'), // 环湖骑行，living，monthly 19.9
    endedFree: await roomIdByKey('demo-room-5'), // 手冲咖啡教学，ended，free
  };
  idleRoomId = roomId.idleFree;
});

afterAll(async () => {
  await ctx.close();
});

describe('直播间的创建 / 编辑 / 开播 / 关播', () => {
  it('首页分类可匿名访问，种子数据 5 个分类', async () => {
    const data = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url('/rooms/categories')));
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(5);
    expect(data[0]).toHaveProperty('name');
  });

  it('房间列表支持分页 / 关键词 / 价格排序', async () => {
    const byKeyword = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/rooms')).query({ keyword: '深夜' }),
    );
    expect(byKeyword.total).toBe(1);
    expect(byKeyword.list[0].title).toContain('深夜');

    const byPrice = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/rooms')).query({ sort: 'price_desc', pageSize: 50 }),
    );
    const prices = byPrice.list.map((item: any) => item.price);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => b - a));
  });

  it('免费房间不能设置价格（403 / 1006）', async () => {
    const res = await ctx.request()
      .post(ctx.url('/rooms'))
      .set('Authorization', `Bearer ${anchorToken}`)
      .send({ title: '免费房带价格', priceType: 'free', price: 9.9 });
    expect(res.status).toBe(403);
    expect((res.body as ApiEnvelope).code).toBe(1006);
  });

  it('付费房间必须设置大于 0 的价格（403）', async () => {
    const res = await ctx.request()
      .post(ctx.url('/rooms'))
      .set('Authorization', `Bearer ${anchorToken}`)
      .send({ title: '付费房没价格', priceType: 'monthly' });
    expect(res.status).toBe(403);
    expect((res.body as ApiEnvelope).code).toBe(1006);
  });

  it('主播建房成功：初始状态 idle，自动创建主播档案', async () => {
    const data = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url('/rooms'))
        .set('Authorization', `Bearer ${anchorToken}`)
        .send({ title: '周杰伦线上歌友会', priceType: 'yearly', price: 199 }),
      201,
    );
    expect(data.status).toBe('idle');
    expect(data.priceType).toBe('yearly');
    expect(data.price).toBe(199);
    expect(data.anchor.displayName).toBe('小野');
    expect(data.access.isOwner).toBe(true);
    idleRoomId = Number(data.id);
  });

  it('开播：idle → living，重复开播被拒绝（409 / 2003）', async () => {
    const started = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/rooms/${idleRoomId}/live/start`))
        .set('Authorization', `Bearer ${anchorToken}`),
      201,
    );
    expect(started.status).toBe('living');
    expect(started.startedAt).toBeTruthy();

    const again = await ctx.request()
      .post(ctx.url(`/rooms/${idleRoomId}/live/start`))
      .set('Authorization', `Bearer ${anchorToken}`);
    expect(again.status).toBe(409);
    expect((again.body as ApiEnvelope).code).toBe(2003);
    expect((again.body as ApiEnvelope).message).toContain('已经在直播中');
  });

  it('开播后房间出现在 living 过滤列表中', async () => {
    const data = TestContext.unwrap<any>(
      await ctx.request().get(ctx.url('/rooms')).query({ status: 'living', pageSize: 50 }),
    );
    expect(data.list.some((item: any) => item.id === idleRoomId)).toBe(true);
    expect(data.list.every((item: any) => item.status === 'living')).toBe(true);
  });

  it('直播中禁止修改计费方式（409 / 2003），下播后可以修改', async () => {
    const blocked = await ctx.request()
      .patch(ctx.url(`/rooms/${idleRoomId}`))
      .set('Authorization', `Bearer ${anchorToken}`)
      .send({ priceType: 'monthly', price: 29 });
    expect(blocked.status).toBe(409);
    expect((blocked.body as ApiEnvelope).code).toBe(2003);

    const ended = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/rooms/${idleRoomId}/live/end`))
        .set('Authorization', `Bearer ${anchorToken}`),
      201,
    );
    expect(ended.status).toBe('ended');
    expect(ended.endedAt).toBeTruthy();

    const patched = TestContext.unwrap<any>(
      await ctx.request()
        .patch(ctx.url(`/rooms/${idleRoomId}`))
        .set('Authorization', `Bearer ${anchorToken}`)
        .send({ priceType: 'monthly', price: 29, title: '周杰伦线上歌友会（会员场）' }),
    );
    expect(patched.priceType).toBe('monthly');
    expect(patched.title).toContain('会员场');
  });

  it('未开播时关播被拒绝（409 / 2003）', async () => {
    const res = await ctx.request()
      .post(ctx.url(`/rooms/${idleRoomId}/live/end`))
      .set('Authorization', `Bearer ${anchorToken}`);
    expect(res.status).toBe(409);
    expect((res.body as ApiEnvelope).code).toBe(2003);
    expect((res.body as ApiEnvelope).message).toContain('当前没有在直播');
  });

  it('只能操作自己的直播间：其他主播开播他人房间被拒绝（403）', async () => {
    const unique = `otheranchor${Date.now().toString().slice(-6)}`;
    const registered = await ctx.request()
      .post(ctx.url('/auth/register'))
      .send({ username: unique, password: 'Passw0rd123', role: 'anchor', nickname: '别的主播' });
    const { accessToken } = TestContext.unwrap<any>(registered, 201);
    const res = await ctx.request()
      .post(ctx.url(`/rooms/${idleRoomId}/live/start`))
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
    expect((res.body as ApiEnvelope).message).toContain('只能操作自己的直播间');
  });

  it('主播中心返回我的直播间列表', async () => {
    const data = TestContext.unwrap<any[]>(
      await ctx.request().get(ctx.url('/rooms/mine')).set('Authorization', `Bearer ${anchorToken}`),
    );
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('title');
  });

  it('管理员可强制下播正在直播的房间', async () => {
    const data = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/admin/rooms/${roomId.freeLiving}/close`))
        .set('Authorization', `Bearer ${adminToken}`),
      201,
    );
    expect(data.status).toBe('ended');
  });
});

describe('直播播放地址（HLS / FLV 双协议 + 权限校验）', () => {
  it('免费直播间返回 HLS + FLV 双协议源与降级顺序', async () => {
    const info = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url(`/streams/${roomId.paidLiving2}/play-info`))
        .set('Authorization', `Bearer ${viewerToken}`)
        .query({ quality: '720p' }),
    );
    expect(info.locked).toBe(true); // paidLiving2 未购买
    expect(info.mode).toBe('offline');

    const free = TestContext.unwrap<any>(await ctx.request().get(ctx.url(`/streams/${roomId.endedFree}/play-info`)));
    expect(free.mode).toBe('demo');
    expect(free.sources).toHaveLength(2);
    expect(free.sources[0].protocol).toBe('hls');
    expect(free.sources[1].protocol).toBe('flv');
    expect(free.fallbackOrder).toEqual(['demo-hls', 'demo-flv', 'demo-state-machine']);
    expect(free.token).toContain('.');
    expect(free.expiresAt).toBeTruthy();
  });

  it('付费直播间未购买时返回锁定信息与价格', async () => {
    const info = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url(`/streams/${roomId.paidLiving}/play-info`))
        .set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(info.locked).toBe(true);
    expect(info.sources).toEqual([]);
    expect(info.lockReason).toContain('付费');
    expect(info.price.amount).toBe(9.9);
  });

  it('房主与管理员观看自己的付费直播间不受限制', async () => {
    const owner = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url(`/streams/${roomId.paidLiving}/play-info`))
        .set('Authorization', `Bearer ${anchorToken}`),
    );
    expect(owner.locked).toBe(false);
    expect(owner.mode).toBe('demo');

    const admin = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url(`/streams/${roomId.paidLiving2}/play-info`))
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(admin.locked).toBe(false);
  });

  it('推流信息仅房主/管理员可见', async () => {
    const owner = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url(`/streams/${roomId.paidLiving}/push-info`))
        .set('Authorization', `Bearer ${anchorToken}`),
    );
    expect(owner.rtmpUrl).toContain('rtmp://');
    expect(owner.streamKey).toContain('demo-room-1');
    expect(owner.obs.encoder).toContain('x264');

    const viewer = await ctx.request()
      .get(ctx.url(`/streams/${roomId.paidLiving}/push-info`))
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(viewer.status).toBe(403);
  });

  it('主播数据看板只对房主开放，且返回时长/人数/礼物收入', async () => {
    const stats = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url(`/streams/${roomId.paidLiving}/stats`))
        .set('Authorization', `Bearer ${anchorToken}`),
    );
    expect(stats.roomId).toBe(roomId.paidLiving);
    expect(typeof stats.viewers).toBe('number');
    expect(typeof stats.durationSec).toBe('number');
    expect(stats.demoMode).toBe(true);

    const denied = await ctx.request()
      .get(ctx.url(`/streams/${roomId.paidLiving}/stats`))
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(denied.status).toBe(403);
  });
});

describe('进入房间 / 点赞 / 点播与礼物的上下架', () => {
  it('进入直播间累加在线人数并写观看历史', async () => {
    const before = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url(`/rooms/${roomId.paidLiving}`))
        .set('Authorization', `Bearer ${viewerToken}`),
    );
    const entered = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/rooms/${roomId.paidLiving}/enter`))
        .set('Authorization', `Bearer ${viewerToken}`),
      201,
    );
    expect(entered.viewers).toBe(before.viewers + 1);
    expect(entered.status).toBe('living');

    const history = await ctx.db('view_history').where({ room_id: roomId.paidLiving });
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('点赞数自增', async () => {
    const before = TestContext.unwrap<any>(
      await ctx.request()
        .get(ctx.url(`/rooms/${roomId.paidLiving}`))
        .set('Authorization', `Bearer ${viewerToken}`),
    );
    const liked = TestContext.unwrap<any>(
      await ctx.request()
        .post(ctx.url(`/rooms/${roomId.paidLiving}/like`))
        .set('Authorization', `Bearer ${viewerToken}`),
      201,
    );
    expect(liked.likes).toBe(before.likes + 1);
  });

  it('点播上下架：下架后列表隐藏、详情 404，上架后恢复', async () => {
    const published = TestContext.unwrap<any>(await ctx.request().get(ctx.url('/videos')).query({ pageSize: 50 }));
    expect(published.total).toBe(3);
    const target = published.list[0];

    await ctx.db('video').where({ id: target.id }).update({ status: 'draft' });
    const hidden = TestContext.unwrap<any>(await ctx.request().get(ctx.url('/videos')).query({ pageSize: 50 }));
    expect(hidden.total).toBe(2);
    const detailHidden = await ctx.request().get(ctx.url(`/videos/${target.id}`));
    expect(detailHidden.status).toBe(404);

    await ctx.db('video').where({ id: target.id }).update({ status: 'published' });
    const restored = TestContext.unwrap<any>(await ctx.request().get(ctx.url('/videos')).query({ pageSize: 50 }));
    expect(restored.total).toBe(3);
  });

  it('礼物列表只返回上架中的礼物，下架后立即从商城消失', async () => {
    const list = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url('/gifts')));
    expect(list.length).toBe(5);
    const target = list.find((item: any) => item.name === '小心心');

    await ctx.db('gift').where({ id: target.id }).update({ enabled: false });
    const after = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url('/gifts')));
    expect(after.length).toBe(4);
    expect(after.some((item: any) => item.id === target.id)).toBe(false);

    await ctx.db('gift').where({ id: target.id }).update({ enabled: true });
    const restored = TestContext.unwrap<any[]>(await ctx.request().get(ctx.url('/gifts')));
    expect(restored.length).toBe(5);
  });
});
