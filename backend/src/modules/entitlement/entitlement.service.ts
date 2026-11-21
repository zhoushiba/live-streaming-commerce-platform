import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../../database/knex.factory';
import { TABLES, TargetType } from '../../database/schema';
import { toDate, toIso } from '../../common/utils/time.util';

export interface GrantInput {
  userId: number;
  targetType: TargetType;
  targetId: number;
  orderId?: number | null;
  source?: string;
  /** 会员类权益的天数；点播单片为 null（永久） */
  durationDays?: number | null;
}

export interface EntitlementView {
  id: number;
  targetType: TargetType;
  targetId: number;
  source: string;
  orderId: number | null;
  startAt: string | null;
  expireAt: string | null;
  status: string;
  active: boolean;
}

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(@Inject(KNEX) private readonly db: Knex) {}

  /**
   * 发放权益（必须传入事务，保证与「订单置为已支付」同一事务原子提交）。
   * 同一用户同一内容只有一行，重复购买按「剩余有效期顺延」处理。
   */
  async grant(trx: Knex.Transaction, input: GrantInput): Promise<EntitlementView> {
    const table = trx(TABLES.entitlement);
    const existing = await table
      .where({ user_id: input.userId, target_type: input.targetType, target_id: input.targetId })
      .first();

    const now = new Date();
    if (existing) {
      const currentExpire = toDate(existing.expire_at);
      const base = currentExpire && currentExpire.getTime() > now.getTime() ? currentExpire : now;
      const expireAt =
        input.durationDays === null || input.durationDays === undefined
          ? null
          : new Date(base.getTime() + input.durationDays * 24 * 60 * 60 * 1000);
      await table.where({ id: existing.id }).update({
        status: 'active',
        source: input.source ?? 'order',
        order_id: input.orderId ?? existing.order_id,
        start_at: existing.start_at ?? now,
        expire_at: expireAt,
      });
      return {
        id: existing.id,
        targetType: input.targetType,
        targetId: input.targetId,
        source: input.source ?? 'order',
        orderId: input.orderId ?? existing.order_id,
        startAt: toIso(existing.start_at ?? now),
        expireAt: toIso(expireAt),
        status: 'active',
        active: true,
      };
    }

    const expireAt =
      input.durationDays === null || input.durationDays === undefined
        ? null
        : new Date(now.getTime() + input.durationDays * 24 * 60 * 60 * 1000);
    const [id] = await table.insert({
      user_id: input.userId,
      target_type: input.targetType,
      target_id: input.targetId,
      source: input.source ?? 'order',
      order_id: input.orderId ?? null,
      start_at: now,
      expire_at: expireAt,
      status: 'active',
      created_at: now,
    });
    this.logger.log(`发放权益 user=${input.userId} ${input.targetType}#${input.targetId} 至 ${expireAt ? expireAt.toISOString() : '永久'}`);
    return {
      id: id as number,
      targetType: input.targetType,
      targetId: input.targetId,
      source: input.source ?? 'order',
      orderId: input.orderId ?? null,
      startAt: toIso(now),
      expireAt: toIso(expireAt),
      status: 'active',
      active: true,
    };
  }

  /** 是否拥有有效权益：status=active 且未过期 */
  async hasAccess(userId: number | undefined, targetType: TargetType, targetId: number): Promise<boolean> {
    if (!userId) return false;
    const row = await this.db(TABLES.entitlement)
      .where({ user_id: userId, target_type: targetType, target_id: targetId })
      .first();
    if (!row) return false;
    if (row.status !== 'active') return false;
    const expireAt = toDate(row.expire_at);
    return !expireAt || expireAt.getTime() > Date.now();
  }

  /** 退款成功后回收权益（仅回收由该订单发放的部分） */
  async revokeByOrder(trx: Knex.Transaction, orderId: number): Promise<number> {
    const affected = await trx(TABLES.entitlement)
      .where({ order_id: orderId })
      .update({ status: 'revoked', expire_at: new Date() });
    return Number(affected ?? 0);
  }

  async listMine(userId: number): Promise<EntitlementView[]> {
    const rows = await this.db(TABLES.entitlement)
      .where({ user_id: userId })
      .orderBy('id', 'desc');
    return rows.map((row) => {
      const expireAt = toDate(row.expire_at);
      return {
        id: row.id,
        targetType: row.target_type as TargetType,
        targetId: row.target_id,
        source: row.source,
        orderId: row.order_id ?? null,
        startAt: toIso(row.start_at),
        expireAt: toIso(row.expire_at),
        status: row.status,
        active: row.status === 'active' && (!expireAt || expireAt.getTime() > Date.now()),
      };
    });
  }

  /** 我买过的点播列表（含视频标题） */
  async listMyVideos(userId: number) {
    return this.db(TABLES.entitlement + ' as e')
      .leftJoin(TABLES.videoEpisode + ' as ep', 'ep.id', 'e.target_id')
      .leftJoin(TABLES.video + ' as v', 'v.id', 'ep.video_id')
      .where('e.user_id', userId)
      .andWhere('e.target_type', 'video')
      .select(
        'e.id as entitlement_id',
        'e.target_id as episode_id',
        'e.status',
        'e.expire_at',
        'v.id as video_id',
        'v.title as video_title',
        'v.cover_url as cover_url',
        'ep.episode_no',
        'ep.title as episode_title',
      )
      .orderBy('e.id', 'desc');
  }
}
