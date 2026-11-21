import { Knex } from 'knex';

export type TargetType = 'room' | 'video';
export type OrderBizType = 'room' | 'video' | 'recharge';
export type OrderStatus = 'pending' | 'paid' | 'closed' | 'refunded';
export type PayProviderCode = 'mock' | 'wechat' | 'alipay';
export type RoomStatus = 'idle' | 'living' | 'ended';
export type UserRole = 'viewer' | 'anchor' | 'admin';

export const TABLES = {
  user: 'user',
  userBalance: 'user_balance',
  balanceTransaction: 'balance_transaction',
  refreshToken: 'refresh_token',
  anchor: 'anchor',
  roomCategory: 'room_category',
  liveRoom: 'live_room',
  video: 'video',
  videoEpisode: 'video_episode',
  entitlement: 'purchase_entitlement',
  danmaku: 'danmaku',
  gift: 'gift',
  giftRecord: 'gift_record',
  viewHistory: 'view_history',
  order: 'orders',
  orderItem: 'order_item',
  paymentTransaction: 'payment_transaction',
  refundRecord: 'refund_record',
  reconciliationLog: 'reconciliation_log',
  sysConfig: 'sys_config',
} as const;

/** 建表：幂等，SQLite（本地/测试）与 MySQL（生产）共用同一份定义 */
export async function migrate(knex: Knex): Promise<void> {
  const mysql = knex.client.config.client === 'mysql2';

  const withMeta = (t: Knex.CreateTableBuilder) => {
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  };
  // Knex 的表级选项（engine/charset/collate）在类型上属于 CreateTableBuilder，
  // 而 createTable() 返回的是 SchemaBuilder；运行时同一个对象，这里用最小接口收敛类型。
  type TableOptionsBuilder = {
    engine(value: string): TableOptionsBuilder;
    charset(value: string): TableOptionsBuilder;
    collate(value: string): TableOptionsBuilder;
  };
  const charset = (builder: Knex.SchemaBuilder) => {
    if (mysql) {
      (builder as unknown as TableOptionsBuilder)
        .engine('InnoDB')
        .charset('utf8mb4')
        .collate('utf8mb4_unicode_ci');
    }
    return builder;
  };

  if (!(await knex.schema.hasTable(TABLES.user))) {
    await charset(
      knex.schema.createTable(TABLES.user, (t) => {
        t.bigIncrements('id').primary();
        t.string('username', 32).notNullable().unique();
        t.string('nickname', 32).notNullable();
        t.string('password_hash', 100).notNullable();
        t.string('role', 16).notNullable().defaultTo('viewer');
        t.string('avatar', 255).nullable();
        t.string('status', 16).notNullable().defaultTo('active');
        t.integer('login_fail_count').notNullable().defaultTo(0);
        t.timestamp('locked_until').nullable();
        t.timestamp('last_login_at').nullable();
        withMeta(t);
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.index(['role'], 'idx_user_role');
        t.index(['created_at'], 'idx_user_created');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.userBalance))) {
    await charset(
      knex.schema.createTable(TABLES.userBalance, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('user_id').notNullable().unique();
        t.decimal('balance', 12, 2).notNullable().defaultTo(0);
        t.decimal('total_recharge', 12, 2).notNullable().defaultTo(0);
        t.decimal('total_consume', 12, 2).notNullable().defaultTo(0);
        t.integer('version').notNullable().defaultTo(0);
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.foreign('user_id').references('id').inTable(TABLES.user).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.balanceTransaction))) {
    await charset(
      knex.schema.createTable(TABLES.balanceTransaction, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('user_id').notNullable();
        // recharge / consume / refund
        t.string('biz_type', 16).notNullable();
        // 带符号：充值为正、消费为负
        t.decimal('amount', 12, 2).notNullable();
        t.decimal('balance_after', 12, 2).notNullable();
        // 幂等键：recharge:<orderNo> / gift:<requestId> / refund:<refundNo>
        t.string('biz_no', 64).notNullable().unique();
        t.string('remark', 255).nullable();
        withMeta(t);
        t.index(['user_id', 'created_at'], 'idx_bt_user_time');
        t.index(['biz_type'], 'idx_bt_type');
        t.foreign('user_id').references('id').inTable(TABLES.user).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.refreshToken))) {
    await charset(
      knex.schema.createTable(TABLES.refreshToken, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('user_id').notNullable();
        // 只存 sha256(token)，数据库泄露也无法直接复用
        t.string('token_hash', 64).notNullable().unique();
        t.string('jti', 64).notNullable();
        t.timestamp('expires_at').notNullable();
        t.timestamp('revoked_at').nullable();
        t.string('user_agent', 255).nullable();
        withMeta(t);
        t.index(['user_id', 'revoked_at'], 'idx_rt_user_revoked');
        t.index(['expires_at'], 'idx_rt_expire');
        t.foreign('user_id').references('id').inTable(TABLES.user).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.anchor))) {
    await charset(
      knex.schema.createTable(TABLES.anchor, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('user_id').notNullable().unique();
        t.string('display_name', 32).notNullable();
        t.string('introduce', 255).nullable();
        t.integer('follower_count').notNullable().defaultTo(0);
        t.boolean('verified').notNullable().defaultTo(false);
        withMeta(t);
        t.foreign('user_id').references('id').inTable(TABLES.user).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.roomCategory))) {
    await charset(
      knex.schema.createTable(TABLES.roomCategory, (t) => {
        t.bigIncrements('id').primary();
        t.string('name', 32).notNullable().unique();
        t.string('icon', 64).nullable();
        t.integer('sort').notNullable().defaultTo(0);
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.liveRoom))) {
    await charset(
      knex.schema.createTable(TABLES.liveRoom, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('anchor_id').notNullable();
        t.bigInteger('category_id').nullable();
        t.string('title', 100).notNullable();
        t.string('cover_url', 255).nullable();
        // idle -> living -> ended
        t.string('status', 16).notNullable().defaultTo('idle');
        // free / monthly / yearly
        t.string('price_type', 16).notNullable().defaultTo('free');
        t.decimal('price', 12, 2).notNullable().defaultTo(0);
        t.integer('viewers').notNullable().defaultTo(0);
        t.integer('peak_viewers').notNullable().defaultTo(0);
        t.integer('likes').notNullable().defaultTo(0);
        t.string('stream_key', 64).notNullable().unique();
        t.timestamp('started_at').nullable();
        t.timestamp('ended_at').nullable();
        withMeta(t);
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        // 首页高频查询：where status = 'living' and category_id = ? order by viewers desc
        t.index(['status', 'category_id'], 'idx_room_status_category');
        // 主播中心：where anchor_id = ? and status = ?
        t.index(['anchor_id', 'status'], 'idx_room_anchor_status');
        t.foreign('anchor_id').references('id').inTable(TABLES.anchor).onDelete('CASCADE');
        t.foreign('category_id').references('id').inTable(TABLES.roomCategory).onDelete('SET NULL');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.video))) {
    await charset(
      knex.schema.createTable(TABLES.video, (t) => {
        t.bigIncrements('id').primary();
        t.string('title', 100).notNullable();
        t.string('cover_url', 255).nullable();
        t.text('description').nullable();
        t.decimal('price', 12, 2).notNullable().defaultTo(0);
        t.bigInteger('category_id').nullable();
        t.string('status', 16).notNullable().defaultTo('published');
        t.integer('play_count').notNullable().defaultTo(0);
        withMeta(t);
        t.index(['status', 'created_at'], 'idx_video_status_created');
        t.foreign('category_id').references('id').inTable(TABLES.roomCategory).onDelete('SET NULL');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.videoEpisode))) {
    await charset(
      knex.schema.createTable(TABLES.videoEpisode, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('video_id').notNullable();
        t.integer('episode_no').notNullable();
        t.string('title', 100).notNullable();
        t.string('play_url', 255).notNullable();
        t.integer('duration').notNullable().defaultTo(0);
        t.boolean('free').notNullable().defaultTo(false);
        withMeta(t);
        t.unique(['video_id', 'episode_no'], 'uk_episode_no');
        t.foreign('video_id').references('id').inTable(TABLES.video).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.entitlement))) {
    await charset(
      knex.schema.createTable(TABLES.entitlement, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('user_id').notNullable();
        t.string('target_type', 16).notNullable();
        t.bigInteger('target_id').notNullable();
        t.string('source', 16).notNullable().defaultTo('order');
        t.bigInteger('order_id').nullable();
        t.timestamp('start_at').notNullable().defaultTo(knex.fn.now());
        // 单片购买为 null（永久）
        t.timestamp('expire_at').nullable();
        t.string('status', 16).notNullable().defaultTo('active');
        withMeta(t);
        // 同一用户对同一内容只有一条权益，重复购买走续期
        t.unique(['user_id', 'target_type', 'target_id'], 'uk_entitlement_target');
        t.index(['order_id'], 'idx_entitlement_order');
        t.index(['expire_at'], 'idx_entitlement_expire');
        t.foreign('user_id').references('id').inTable(TABLES.user).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.danmaku))) {
    await charset(
      knex.schema.createTable(TABLES.danmaku, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('room_id').notNullable();
        t.bigInteger('user_id').nullable();
        t.string('nickname', 32).notNullable();
        t.string('content', 120).notNullable();
        t.string('color', 16).notNullable().defaultTo('#ffffff');
        t.string('status', 16).notNullable().defaultTo('visible');
        t.bigInteger('sent_at').notNullable();
        withMeta(t);
        // 拉取历史弹幕：where room_id = ? order by id desc limit 50
        t.index(['room_id', 'id'], 'idx_danmaku_room_id');
        t.foreign('room_id').references('id').inTable(TABLES.liveRoom).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.gift))) {
    await charset(
      knex.schema.createTable(TABLES.gift, (t) => {
        t.bigIncrements('id').primary();
        t.string('name', 32).notNullable().unique();
        t.string('icon', 64).notNullable();
        t.decimal('price', 12, 2).notNullable();
        t.string('effect', 32).notNullable().defaultTo('none');
        t.integer('sort').notNullable().defaultTo(0);
        t.boolean('enabled').notNullable().defaultTo(true);
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.giftRecord))) {
    await charset(
      knex.schema.createTable(TABLES.giftRecord, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('room_id').notNullable();
        t.bigInteger('user_id').notNullable();
        t.bigInteger('gift_id').notNullable();
        t.integer('count').notNullable().defaultTo(1);
        t.decimal('amount', 12, 2).notNullable();
        // 客户端请求 ID：网络重试/连点不会重复扣款
        t.string('request_id', 64).notNullable().unique();
        withMeta(t);
        t.index(['room_id', 'created_at'], 'idx_gift_record_room');
        t.index(['user_id', 'created_at'], 'idx_gift_record_user');
        t.index(['gift_id', 'created_at'], 'idx_gift_record_gift');
        t.foreign('room_id').references('id').inTable(TABLES.liveRoom).onDelete('CASCADE');
        t.foreign('user_id').references('id').inTable(TABLES.user).onDelete('CASCADE');
        t.foreign('gift_id').references('id').inTable(TABLES.gift).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.viewHistory))) {
    await charset(
      knex.schema.createTable(TABLES.viewHistory, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('user_id').notNullable();
        t.bigInteger('room_id').notNullable();
        t.integer('watched_seconds').notNullable().defaultTo(0);
        withMeta(t);
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.unique(['user_id', 'room_id'], 'uk_view_history');
        t.index(['room_id', 'updated_at'], 'idx_view_room_time');
        t.foreign('user_id').references('id').inTable(TABLES.user).onDelete('CASCADE');
        t.foreign('room_id').references('id').inTable(TABLES.liveRoom).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.order))) {
    await charset(
      knex.schema.createTable(TABLES.order, (t) => {
        t.bigIncrements('id').primary();
        t.string('order_no', 40).notNullable().unique();
        t.bigInteger('user_id').notNullable();
        // room / video / recharge
        t.string('biz_type', 16).notNullable();
        t.bigInteger('target_id').nullable();
        t.decimal('amount', 12, 2).notNullable();
        t.string('status', 16).notNullable().defaultTo('pending');
        // 业务幂等键：同一 key 重复提交返回同一订单
        t.string('idempotency_key', 64).notNullable().unique();
        t.timestamp('expire_at').notNullable();
        t.timestamp('paid_at').nullable();
        t.timestamp('closed_at').nullable();
        t.string('remark', 255).nullable();
        withMeta(t);
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        // 我的订单：where user_id = ? and status = ? order by created_at desc
        t.index(['user_id', 'status', 'created_at'], 'idx_order_user_status');
        // 超时关单扫描：where status = 'pending' and expire_at < now()
        t.index(['status', 'expire_at'], 'idx_order_status_expire');
        t.foreign('user_id').references('id').inTable(TABLES.user).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.orderItem))) {
    await charset(
      knex.schema.createTable(TABLES.orderItem, (t) => {
        t.bigIncrements('id').primary();
        t.bigInteger('order_id').notNullable();
        t.string('title', 100).notNullable();
        t.string('item_type', 16).notNullable();
        t.bigInteger('item_id').nullable();
        t.decimal('price', 12, 2).notNullable();
        t.integer('quantity').notNullable().defaultTo(1);
        t.index(['order_id'], 'idx_order_item_order');
        t.foreign('order_id').references('id').inTable(TABLES.order).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.paymentTransaction))) {
    await charset(
      knex.schema.createTable(TABLES.paymentTransaction, (t) => {
        t.bigIncrements('id').primary();
        // 幂等核心：一个 out_trade_no 在库内唯一，重复回调只能命中同一行
        t.string('out_trade_no', 40).notNullable().unique();
        t.string('order_no', 40).notNullable();
        t.string('provider', 16).notNullable();
        t.string('trade_type', 16).notNullable().defaultTo('JSAPI');
        t.decimal('amount', 12, 2).notNullable();
        // pending / success / failed / refunded
        t.string('status', 16).notNullable().defaultTo('pending');
        t.string('provider_trade_no', 64).nullable().unique();
        t.text('notify_payload').nullable();
        t.timestamp('paid_at').nullable();
        withMeta(t);
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.index(['order_no'], 'idx_pay_order_no');
        t.index(['provider', 'status', 'paid_at'], 'idx_pay_provider_status');
        t.foreign('order_no').references('order_no').inTable(TABLES.order).onDelete('CASCADE');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.refundRecord))) {
    await charset(
      knex.schema.createTable(TABLES.refundRecord, (t) => {
        t.bigIncrements('id').primary();
        t.string('refund_no', 40).notNullable().unique();
        t.string('order_no', 40).notNullable();
        t.bigInteger('payment_tx_id').notNullable();
        t.decimal('amount', 12, 2).notNullable();
        t.string('reason', 255).notNullable();
        // pending / approved / rejected / success
        t.string('status', 16).notNullable().defaultTo('pending');
        t.bigInteger('operator_id').nullable();
        t.string('provider_refund_no', 64).nullable();
        withMeta(t);
        t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        t.index(['order_no'], 'idx_refund_order');
        t.index(['status', 'created_at'], 'idx_refund_status');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.reconciliationLog))) {
    await charset(
      knex.schema.createTable(TABLES.reconciliationLog, (t) => {
        t.bigIncrements('id').primary();
        t.string('bill_date', 10).notNullable();
        t.string('provider', 16).notNullable();
        t.decimal('total_local', 12, 2).notNullable().defaultTo(0);
        t.decimal('total_channel', 12, 2).notNullable().defaultTo(0);
        t.integer('local_count').notNullable().defaultTo(0);
        t.integer('channel_count').notNullable().defaultTo(0);
        t.integer('diff_count').notNullable().defaultTo(0);
        t.text('detail_json').nullable();
        withMeta(t);
        t.unique(['bill_date', 'provider'], 'uk_recon_date_provider');
      }),
    );
  }

  if (!(await knex.schema.hasTable(TABLES.sysConfig))) {
    await charset(
      knex.schema.createTable(TABLES.sysConfig, (t) => {
        t.bigIncrements('id').primary();
        t.string('cfg_key', 64).notNullable().unique();
        t.text('cfg_value').notNullable();
        t.string('remark', 255).nullable();
        withMeta(t);
      }),
    );
  }
}
