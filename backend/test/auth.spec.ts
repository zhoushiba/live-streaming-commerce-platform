import { ACCOUNTS, ApiEnvelope, TestContext } from './helpers/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create('auth');
});

afterAll(async () => {
  await ctx.close();
});

describe('认证与鉴权（JWT 双令牌 + RBAC）', () => {
  it('注册新用户：返回双令牌，并在同一事务内创建钱包', async () => {
    const res = await ctx.request()
      .post(ctx.url('/auth/register'))
      .send({ username: 'newplayer01', password: 'Passw0rd123', nickname: '新观众' });
    expect(res.status).toBe(201);
    const data = TestContext.unwrap<any>(res, 201);
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
    expect(data.tokenType).toBe('Bearer');
    expect(data.expiresIn).toBe(900);
    expect(data.user.username).toBe('newplayer01');
    expect(data.user.role).toBe('viewer');
    expect(data.user.balance).toBe(0);
  });

  it('注册时用户名重复被拒绝（403 / 1006）', async () => {
    const res = await ctx.request()
      .post(ctx.url('/auth/register'))
      .send({ username: 'newplayer01', password: 'Passw0rd123' });
    expect(res.status).toBe(403);
    expect((res.body as ApiEnvelope).code).toBe(1006);
  });

  it('登录种子用户返回资料与余额（viewer 初始余额 200）', async () => {
    const res = await ctx.request().post(ctx.url('/auth/login')).send(ACCOUNTS.viewer);
    expect(res.status).toBe(201);
    const data = TestContext.unwrap<any>(res, 201);
    expect(data.user.username).toBe('viewer');
    expect(data.user.nickname).toBe('观众阿泽');
    expect(data.user.balance).toBe(200);
    expect(data.user.role).toBe('viewer');
  });

  it('密码错误返回 401 / 1001', async () => {
    const res = await ctx.request()
      .post(ctx.url('/auth/login'))
      .send({ username: 'viewer', password: 'WrongPass123' });
    expect(res.status).toBe(401);
    expect((res.body as ApiEnvelope).code).toBe(1001);
  });

  it('连续 5 次密码错误后账号被锁定 15 分钟（429 / 1002）', async () => {
    await ctx.request().post(ctx.url('/auth/register')).send({ username: 'lockuser01', password: 'Passw0rd123' });
    for (let i = 0; i < 5; i += 1) {
      const res = await ctx.request()
        .post(ctx.url('/auth/login'))
        .send({ username: 'lockuser01', password: 'WrongPass123' });
      expect(res.status).toBe(401);
    }
    const locked = await ctx.request()
      .post(ctx.url('/auth/login'))
      .send({ username: 'lockuser01', password: 'Passw0rd123' });
    expect(locked.status).toBe(429);
    expect((locked.body as ApiEnvelope).code).toBe(1002);
  });

  it('刷新令牌执行轮换：旧 refreshToken 立即失效', async () => {
    const login = await ctx.login(ACCOUNTS.viewer.username, ACCOUNTS.viewer.password);
    const first = await ctx.request().post(ctx.url('/auth/refresh')).send({ refreshToken: login.refreshToken });
    const rotated = TestContext.unwrap<any>(first, 201);
    expect(rotated.refreshToken).not.toBe(login.refreshToken);

    const reused = await ctx.request().post(ctx.url('/auth/refresh')).send({ refreshToken: login.refreshToken });
    expect(reused.status).toBe(401);
    expect((reused.body as ApiEnvelope).code).toBe(1005); // REFRESH_TOKEN_REVOKED
  });

  it('登出后 access token 进入黑名单，立即不可用', async () => {
    const login = await ctx.login(ACCOUNTS.viewer2.username, ACCOUNTS.viewer2.password);
    const profileOk = await ctx.request()
      .get(ctx.url('/auth/profile'))
      .set('Authorization', `Bearer ${login.accessToken}`);
    expect(profileOk.status).toBe(200);

    const logout = await ctx.request()
      .post(ctx.url('/auth/logout'))
      .set('Authorization', `Bearer ${login.accessToken}`)
      .send({ refreshToken: login.refreshToken });
    expect(logout.status).toBe(201);

    const profileAfter = await ctx.request()
      .get(ctx.url('/auth/profile'))
      .set('Authorization', `Bearer ${login.accessToken}`);
    expect(profileAfter.status).toBe(401);
    expect((profileAfter.body as ApiEnvelope).code).toBe(1003);
  });

  it('伪造令牌被拒绝（401 / 1003）', async () => {
    const res = await ctx.request().get(ctx.url('/auth/profile')).set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect((res.body as ApiEnvelope).code).toBe(1003);
  });

  it('角色守卫：观众不能建房，主播可以', async () => {
    const viewerToken = await ctx.token('viewer');
    const forbidden = await ctx.request()
      .post(ctx.url('/rooms'))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ title: '观众想开播' });
    expect(forbidden.status).toBe(403);

    const anchorToken = await ctx.token('anchor');
    const created = await ctx.request()
      .post(ctx.url('/rooms'))
      .set('Authorization', `Bearer ${anchorToken}`)
      .send({ title: '主播新开一个房间' });
    expect(created.status).toBe(201);
    expect(TestContext.unwrap<any>(created).status).toBe('idle');
  });

  it('个人资料可更新昵称', async () => {
    const token = await ctx.token('viewer');
    const res = await ctx.request()
      .patch(ctx.url('/auth/profile'))
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '阿泽改名了' });
    expect(res.status).toBe(200);
    expect(TestContext.unwrap<any>(res).nickname).toBe('阿泽改名了');
  });
});
