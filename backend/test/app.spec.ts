import { ApiEnvelope, TestContext } from './helpers/test-app';

const ctxRef: { current?: TestContext } = {};

beforeAll(async () => {
  ctxRef.current = await TestContext.create('app');
});

afterAll(async () => {
  await ctxRef.current?.close();
});

describe('平台基础能力（未鉴权 / 健康检查 / 统一响应）', () => {
  it('GET /api/health 返回服务与依赖状态', async () => {
    const ctx = ctxRef.current!;
    const res = await ctx.request().get(ctx.url('/health'));
    expect(res.status).toBe(200);
    const body = res.body as ApiEnvelope<any>;
    expect(body.code).toBe(0);
    expect(body.requestId).toBeTruthy();
    expect(body.data.status).toBe('ok');
    expect(body.data.dbClient).toBe('sqlite');
    expect(body.data.streamMode).toBe('demo');
    expect(body.data.paymentChannels).toEqual(expect.arrayContaining(['mock', 'wechat', 'alipay']));
    expect(typeof body.data.uptimeSeconds).toBe('number');
  });

  it('每个响应都带 X-Request-Id，并回显请求方传入的链路 ID', async () => {
    const ctx = ctxRef.current!;
    const res = await ctx.request().get(ctx.url('/health')).set('x-request-id', 'trace-from-test-001');
    expect(res.headers['x-request-id']).toBe('trace-from-test-001');
    expect((res.body as ApiEnvelope).requestId).toBe('trace-from-test-001');
  });

  it('首页直播列表可匿名访问，且返回分页结构', async () => {
    const ctx = ctxRef.current!;
    const data = TestContext.unwrap(
      await ctx.request().get(ctx.url('/rooms')).query({ page: 1, pageSize: 10, status: 'living' }),
    );
    expect(Array.isArray(data.list)).toBe(true);
    expect(data.list.length).toBeGreaterThanOrEqual(3);
    expect(data.total).toBeGreaterThanOrEqual(3);
    expect(data.list.every((room: any) => room.status === 'living')).toBe(true);
    expect(data.list[0]).toHaveProperty('title');
    expect(data.list[0]).toHaveProperty('priceType');
  });

  it('未登录访问受保护接口返回 401 + 令牌错误码', async () => {
    const ctx = ctxRef.current!;
    const res = await ctx.request().get(ctx.url('/orders'));
    expect(res.status).toBe(401);
    const body = res.body as ApiEnvelope;
    expect(body.code).toBe(1003); // TOKEN_INVALID
    expect((body as any).path).toBe('/api/orders');
  });

  it('请求体校验失败返回 400 + 校验错误码', async () => {
    const ctx = ctxRef.current!;
    const res = await ctx.request().post(ctx.url('/auth/register')).send({ username: 'x', password: '123' });
    expect(res.status).toBe(400);
    expect((res.body as ApiEnvelope).code).toBe(9001); // VALIDATION_FAILED
  });

  it('未知路由返回 404 + 资源不存在码', async () => {
    const ctx = ctxRef.current!;
    const res = await ctx.request().get(ctx.url('/definitely-not-here'));
    expect(res.status).toBe(404);
    expect((res.body as ApiEnvelope).code).toBe(9002); // RESOURCE_NOT_FOUND
  });

  it('普通用户访问运营后台返回 403（角色守卫）', async () => {
    const ctx = ctxRef.current!;
    const token = await ctx.token('viewer');
    const res = await ctx.request().get(ctx.url('/admin/stats')).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect((res.body as ApiEnvelope).code).toBe(1006); // FORBIDDEN
  });

  it('管理员可读取运营看板，字段齐全', async () => {
    const ctx = ctxRef.current!;
    const token = await ctx.token('admin');
    const data = TestContext.unwrap(
      await ctx.request().get(ctx.url('/admin/stats')).set('Authorization', `Bearer ${token}`),
    );
    expect(data.users.total).toBeGreaterThanOrEqual(4);
    expect(data.rooms.total).toBeGreaterThanOrEqual(5);
    expect(data.rooms.living).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.paymentChannels)).toBe(true);
    expect(data.generatedAt).toBeTruthy();
  });
});
