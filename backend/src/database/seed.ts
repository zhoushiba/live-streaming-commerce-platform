import * as bcrypt from 'bcryptjs';
import { Knex } from 'knex';
import { AppConfig } from '../config/app-config';

/**
 * 演示种子数据：可重复执行（按唯一键判重），
 * 覆盖 3 类角色、5 个直播间、3 部点播、5 种礼物、弹幕/礼物榜/钱包流水。
 */
export async function seedDatabase(db: Knex, config: AppConfig, log: (msg: string) => void = () => void 0): Promise<void> {
  const now = new Date();
  const hash = (plain: string) => bcrypt.hashSync(plain, 10);

  // ---------- 用户 ----------
  const ensureUser = async (username: string, password: string, nickname: string, role: string) => {
    const exists = await db('user').where({ username }).first();
    if (exists) return exists;
    const [id] = await db('user').insert({
      username,
      nickname,
      password_hash: hash(password),
      role,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    return db('user').where({ id }).first();
  };

  const admin = await ensureUser(config.seed.adminUsername, config.seed.adminPassword, '平台运营', 'admin');
  const anchorUser = await ensureUser(config.seed.anchorUsername, config.seed.anchorPassword, '主播小野', 'anchor');
  const viewer = await ensureUser(config.seed.viewerUsername, config.seed.viewerPassword, '观众阿泽', 'viewer');
  const viewer2 = await ensureUser('viewer2', 'Viewer2@123456', '观众小林', 'viewer');

  const ensureBalance = async (userId: number, amount: number) => {
    const row = await db('user_balance').where({ user_id: userId }).first();
    if (row) return;
    await db('user_balance').insert({
      user_id: userId,
      balance: amount,
      total_recharge: amount,
      total_consume: 0,
      version: 0,
      updated_at: now,
    });
    if (amount > 0) {
      await db('balance_transaction').insert({
        user_id: userId,
        biz_type: 'recharge',
        amount,
        balance_after: amount,
        biz_no: `seed:recharge:${userId}`,
        remark: '演示数据初始充值',
        created_at: now,
      });
    }
  };
  await ensureBalance(admin.id, 0);
  await ensureBalance(anchorUser.id, 0);
  await ensureBalance(viewer.id, 200);
  await ensureBalance(viewer2.id, 50);

  // ---------- 主播 ----------
  let anchor = await db('anchor').where({ user_id: anchorUser.id }).first();
  if (!anchor) {
    const [anchorId] = await db('anchor').insert({
      user_id: anchorUser.id,
      display_name: '小野',
      introduce: '钢琴 / 治愈系电台主播，每晚 8 点开播',
      follower_count: 12800,
      verified: true,
      created_at: now,
    });
    anchor = await db('anchor').where({ id: anchorId }).first();
  }

  // ---------- 分类 ----------
  const categories = [
    { name: '音乐现场', icon: '🎵', sort: 1 },
    { name: '游戏电竞', icon: '🎮', sort: 2 },
    { name: '知识分享', icon: '📚', sort: 3 },
    { name: '户外生活', icon: '🏕️', sort: 4 },
    { name: '美食手作', icon: '☕', sort: 5 },
  ];
  for (const c of categories) {
    const exists = await db('room_category').where({ name: c.name }).first();
    if (!exists) await db('room_category').insert(c);
  }
  const catRows = await db('room_category').orderBy('sort', 'asc');
  const catId = (name: string) => catRows.find((c) => c.name === name)?.id ?? catRows[0].id;

  // ---------- 礼物 ----------
  const gifts = [
    { name: '小心心', icon: '💗', price: 1, effect: 'float', sort: 1 },
    { name: '棒棒糖', icon: '🍭', price: 5, effect: 'float', sort: 2 },
    { name: '火箭', icon: '🚀', price: 88, effect: 'rocket', sort: 3 },
    { name: '皇冠', icon: '👑', price: 200, effect: 'crown', sort: 4 },
    { name: '嘉年华', icon: '🎡', price: 520, effect: 'carnival', sort: 5 },
  ];
  for (const g of gifts) {
    const exists = await db('gift').where({ name: g.name }).first();
    if (!exists) await db('gift').insert({ ...g, enabled: true });
  }
  const giftRows = await db('gift').orderBy('price', 'asc');

  // ---------- 直播间 ----------
  const rooms = [
    {
      title: '深夜电台 · 治愈系钢琴',
      cover_url: '/covers/cover-1.svg',
      category_id: catId('音乐现场'),
      status: 'living',
      price_type: 'monthly',
      price: 9.9,
      viewers: 1287,
      peak_viewers: 2031,
      likes: 8632,
      stream_key: 'demo-room-1',
    },
    {
      title: '峡谷上分实录 · 王者五排',
      cover_url: '/covers/cover-2.svg',
      category_id: catId('游戏电竞'),
      status: 'living',
      price_type: 'free',
      price: 0,
      viewers: 642,
      peak_viewers: 910,
      likes: 3120,
      stream_key: 'demo-room-2',
    },
    {
      title: '前端工程化实战 · NestJS 支付链路拆解',
      cover_url: '/covers/cover-3.svg',
      category_id: catId('知识分享'),
      status: 'idle',
      price_type: 'free',
      price: 0,
      viewers: 0,
      peak_viewers: 0,
      likes: 421,
      stream_key: 'demo-room-3',
    },
    {
      title: '环湖骑行 30km · 第一视角直播',
      cover_url: '/covers/cover-4.svg',
      category_id: catId('户外生活'),
      status: 'living',
      price_type: 'monthly',
      price: 19.9,
      viewers: 356,
      peak_viewers: 502,
      likes: 1890,
      stream_key: 'demo-room-4',
    },
    {
      title: '手冲咖啡教学 · 从磨豆到品鉴',
      cover_url: '/covers/cover-5.svg',
      category_id: catId('美食手作'),
      status: 'ended',
      price_type: 'free',
      price: 0,
      viewers: 0,
      peak_viewers: 733,
      likes: 2564,
      stream_key: 'demo-room-5',
    },
  ];
  for (const r of rooms) {
    const exists = await db('live_room').where({ stream_key: r.stream_key }).first();
    if (exists) continue;
    await db('live_room').insert({
      ...r,
      anchor_id: anchor.id,
      started_at: r.status === 'living' ? new Date(Date.now() - 1000 * 60 * 47) : null,
      ended_at: r.status === 'ended' ? new Date(Date.now() - 1000 * 60 * 60 * 3) : null,
      created_at: now,
      updated_at: now,
    });
  }
  const roomRows = await db('live_room').orderBy('id', 'asc');
  const room1 = roomRows[0];

  // ---------- 点播 ----------
  const videos = [
    {
      title: 'NestJS 支付系统实战：从下单到回调幂等',
      cover_url: '/covers/cover-3.svg',
      description: '手写 PaymentProvider 抽象、微信 V3 验签、回调幂等与事务发权益。',
      price: 29.9,
      category_id: catId('知识分享'),
      episodes: [
        { episode_no: 1, title: '试看 · 支付链路全景', duration: 372, free: true },
        { episode_no: 2, title: '微信 V3 签名与验签', duration: 1284, free: false },
        { episode_no: 3, title: '回调幂等与事务一致性', duration: 1560, free: false },
      ],
    },
    {
      title: 'HLS / FLV 直播协议精讲',
      cover_url: '/covers/cover-1.svg',
      description: 'm3u8 切片原理、hls.js 自适应码率、flv.js 低延迟播放与断流重连。',
      price: 19.9,
      category_id: catId('知识分享'),
      episodes: [
        { episode_no: 1, title: 'HLS 切片与播放列表', duration: 900, free: false },
        { episode_no: 2, title: 'FLV 与 HTTP-FLV 拉流', duration: 1100, free: false },
      ],
    },
    {
      title: 'Vue3 组件设计模式（公开课）',
      cover_url: '/covers/cover-5.svg',
      description: '组合式 API 抽象、插槽设计、播放器组件的状态机拆分。',
      price: 0,
      category_id: catId('知识分享'),
      episodes: [
        { episode_no: 1, title: '组合式 API 抽象', duration: 780, free: true },
        { episode_no: 2, title: '播放器状态机拆分', duration: 960, free: true },
      ],
    },
  ];
  for (const v of videos) {
    const exists = await db('video').where({ title: v.title }).first();
    if (exists) continue;
    const [videoId] = await db('video').insert({
      title: v.title,
      cover_url: v.cover_url,
      description: v.description,
      price: v.price,
      category_id: v.category_id,
      status: 'published',
      play_count: Math.floor(Math.random() * 4000) + 200,
      created_at: now,
    });
    for (const ep of v.episodes) {
      await db('video_episode').insert({
        video_id: videoId,
        episode_no: ep.episode_no,
        title: ep.title,
        play_url: `/stream/vod/video-${videoId}-ep${ep.episode_no}.m3u8`,
        duration: ep.duration,
        free: ep.free,
        created_at: now,
      });
    }
  }

  // ---------- 弹幕历史 ----------
  const danmakuCount = await db('danmaku').count<{ c: number }[]>('id as c');
  if (Number(danmakuCount[0]?.c ?? 0) === 0) {
    const seeds = [
      { content: '这首歌单曲循环一整天了', nickname: '观众阿泽', user_id: viewer.id, offset: 180 },
      { content: '主播弹得太稳了，求个曲名', nickname: '观众小林', user_id: viewer2.id, offset: 120 },
      { content: '已开通月卡，支持！', nickname: '观众阿泽', user_id: viewer.id, offset: 60 },
      { content: '音质好像有点卡？', nickname: '路人甲', user_id: null, offset: 30 },
    ];
    for (const d of seeds) {
      await db('danmaku').insert({
        room_id: room1.id,
        user_id: d.user_id,
        nickname: d.nickname,
        content: d.content,
        color: '#ffffff',
        status: 'visible',
        sent_at: Date.now() - d.offset * 1000,
        created_at: now,
      });
    }
  }

  // ---------- 礼物榜历史 ----------
  const giftRecordCount = await db('gift_record').count<{ c: number }[]>('id as c');
  if (Number(giftRecordCount[0]?.c ?? 0) === 0) {
    const rocket = giftRows.find((g) => g.name === '火箭');
    const candy = giftRows.find((g) => g.name === '棒棒糖');
    if (rocket && candy) {
      await db('gift_record').insert([
        {
          room_id: room1.id,
          user_id: viewer2.id,
          gift_id: rocket.id,
          count: 1,
          amount: Number(rocket.price),
          request_id: `seed-gift-${room1.id}-1`,
          created_at: new Date(Date.now() - 600 * 1000),
        },
        {
          room_id: room1.id,
          user_id: viewer.id,
          gift_id: candy.id,
          count: 3,
          amount: Number(candy.price) * 3,
          request_id: `seed-gift-${room1.id}-2`,
          created_at: new Date(Date.now() - 300 * 1000),
        },
      ]);
    }
  }

  // ---------- 系统配置 ----------
  const configs = [
    { cfg_key: 'recharge.min_amount', cfg_value: '1', remark: '单笔充值最低金额' },
    { cfg_key: 'recharge.max_amount', cfg_value: '10000', remark: '单笔充值最高金额' },
    { cfg_key: 'order.timeout_minutes', cfg_value: '15', remark: '订单未支付自动关闭时长' },
    { cfg_key: 'danmaku.default_color', cfg_value: '#ffffff', remark: '默认弹幕颜色' },
  ];
  for (const c of configs) {
    const exists = await db('sys_config').where({ cfg_key: c.cfg_key }).first();
    if (!exists) await db('sys_config').insert({ ...c, created_at: now });
  }

  log('种子数据就绪：3 个角色账号 / 5 个直播间 / 3 部点播 / 5 种礼物');
}
