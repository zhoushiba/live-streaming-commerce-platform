import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../../database/knex.factory';
import { TABLES } from '../../database/schema';
import { BizError, BizErrors } from '../../common/errors/business.exception';
import { AuthUser } from '../../common/decorators/auth.decorators';
import { isUniqueViolation } from '../../common/utils/id.util';
import { toCents, toYuan } from '../../common/utils/money.util';
import { toIso } from '../../common/utils/time.util';
import { LiveGateway } from '../danmaku/live.gateway';

export interface GiftView {
  id: number;
  roomId: number;
  userId: number;
  giftId: number;
  giftName: string;
  icon: string;
  count: number;
  amount: number;
  balance: number;
  requestId: string;
  idempotent: boolean;
  createdAt: string | null;
}

@Injectable()
export class GiftService {
  private readonly logger = new Logger(GiftService.name);

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly gateway: LiveGateway,
  ) {}

  async listGifts() {
    return this.db(TABLES.gift).where({ enabled: true }).orderBy('sort', 'asc');
  }

  async leaderboard(roomId: number, limit = 10) {
    const rows = await this.db(TABLES.giftRecord + ' as g')
      .join(TABLES.user + ' as u', 'u.id', 'g.user_id')
      .where('g.room_id', roomId)
      .groupBy('g.user_id', 'u.nickname')
      .select('g.user_id', 'u.nickname')
      .sum({ total: 'g.amount' })
      .count({ count: 'g.id' })
      .orderBy('total', 'desc')
      .limit(limit);
    return (rows as unknown as Array<{ user_id: number; nickname: string; total: string | number; count: string | number }>).map((row) => ({
      userId: row.user_id,
      nickname: row.nickname,
      totalAmount: toYuan(toCents(Number(row.total ?? 0))),
      giftCount: Number(row.count ?? 0),
    }));
  }

  /**
   * 送礼：一次事务内完成「原子扣余额 → 写送礼记录 → 写流水」。
   * 并发安全靠 `UPDATE ... WHERE balance >= ?`：影响行数为 0 即余额不足，
   * 不需要先 SELECT 再判断（那样在并发下会超扣）。
   */
  async send(
    user: AuthUser,
    input: { roomId: number; giftId: number; count: number; requestId: string },
  ): Promise<GiftView> {
    const count = Math.trunc(input.count);
    if (!Number.isFinite(count) || count <= 0 || count > 99) {
      throw BizErrors.invalidParameter('礼物数量需在 1-99 之间');
    }
    if (!input.requestId || input.requestId.length < 8 || input.requestId.length > 64) {
      throw BizErrors.invalidParameter('requestId 长度需在 8-64 之间（客户端生成，用于防重复扣款）');
    }

    // 幂等：同一 requestId 直接返回上次结果，不再扣款
    const existing = await this.db(TABLES.giftRecord).where({ request_id: input.requestId }).first();
    if (existing) {
      return this.toView(existing, await this.balanceOf(user.id), true);
    }

    const gift = await this.db(TABLES.gift).where({ id: input.giftId, enabled: true }).first();
    if (!gift) throw BizErrors.notFound('礼物不存在或已下架');
    const room = await this.db(TABLES.liveRoom).where({ id: input.roomId }).first('id');
    if (!room) throw BizErrors.notFound('直播间不存在');

    const amount = toYuan(toCents(gift.price) * count);
    if (amount <= 0) throw BizErrors.invalidParameter('礼物金额异常');

    let recordId: number;
    try {
      recordId = await this.db.transaction(async (trx) => {
        const affected = await trx(TABLES.userBalance)
          .where({ user_id: user.id })
          .andWhere('balance', '>=', amount)
          .update({
            balance: trx.raw('balance - ?', [amount]),
            total_consume: trx.raw('total_consume + ?', [amount]),
            version: trx.raw('version + 1'),
            updated_at: new Date(),
          });
        if (Number(affected) === 0) {
          throw BizErrors.insufficientBalance();
        }

        const balanceRow = await trx(TABLES.userBalance).where({ user_id: user.id }).first('balance');
        const balanceAfter = toYuan(toCents(balanceRow?.balance ?? 0));

        const [id] = await trx(TABLES.giftRecord).insert({
          room_id: input.roomId,
          user_id: user.id,
          gift_id: input.giftId,
          count,
          amount,
          request_id: input.requestId,
          created_at: new Date(),
        });
        await trx(TABLES.balanceTransaction).insert({
          user_id: user.id,
          biz_type: 'consume',
          amount: -amount,
          balance_after: balanceAfter,
          biz_no: `gift:${input.requestId}`,
          remark: `赠送 ${gift.name} x${count}`,
          created_at: new Date(),
        });
        return id as number;
      });
    } catch (error) {
      if (error instanceof BizError) throw error;
      // 并发下同一 requestId 双写：唯一键冲突 → 回读已存在记录，视为幂等成功
      if (isUniqueViolation(error)) {
        const row = await this.db(TABLES.giftRecord).where({ request_id: input.requestId }).first();
        if (row) return this.toView(row, await this.balanceOf(user.id), true);
      }
      throw error;
    }

    const row = await this.db(TABLES.giftRecord).where({ id: recordId }).first();
    const view = await this.toView(row, await this.balanceOf(user.id), false);
    const sender = await this.db(TABLES.user).where({ id: user.id }).first('nickname');
    this.logger.log(`礼物入账 user=${user.id} gift=${gift.name}x${count} amount=${amount}`);
    this.gateway.broadcastGift(view.roomId, {
      type: 'gift',
      id: view.id,
      roomId: view.roomId,
      userId: view.userId,
      nickname: sender?.nickname ?? '观众',
      giftName: gift.name,
      icon: gift.icon,
      count: view.count,
      amount: view.amount,
      createdAt: view.createdAt,
    });
    return view;
  }

  private async balanceOf(userId: number): Promise<number> {
    const row = await this.db(TABLES.userBalance).where({ user_id: userId }).first('balance');
    return toYuan(toCents(row?.balance ?? 0));
  }

  private async toView(row: Record<string, any>, balance: number, idempotent: boolean): Promise<GiftView> {
    const gift = row ? await this.db(TABLES.gift).where({ id: row.gift_id }).first() : null;
    return {
      id: Number(row?.id ?? 0),
      roomId: Number(row?.room_id ?? 0),
      userId: Number(row?.user_id ?? 0),
      giftId: Number(row?.gift_id ?? 0),
      giftName: gift?.name ?? '礼物',
      icon: gift?.icon ?? '',
      count: Number(row?.count ?? 0),
      amount: toYuan(toCents(row?.amount ?? 0)),
      balance,
      requestId: String(row?.request_id ?? ''),
      idempotent,
      createdAt: toIso(row?.created_at),
    };
  }

  /** 我送出的礼物记录 */
  async myRecords(userId: number, page = 1, pageSize = 20) {
    const base = this.db(TABLES.giftRecord + ' as g')
      .join(TABLES.gift + ' as gf', 'gf.id', 'g.gift_id')
      .leftJoin(TABLES.liveRoom + ' as r', 'r.id', 'g.room_id')
      .where('g.user_id', userId);
    const countRow = await base.clone().count<{ total: number }[]>({ total: '*' }).first();
    const rows = await base
      .clone()
      .select('g.*', 'gf.name as gift_name', 'gf.icon', 'r.title as room_title')
      .orderBy('g.id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      items: rows.map((row) => ({
        id: row.id,
        roomId: row.room_id,
        roomTitle: row.room_title,
        giftName: row.gift_name,
        icon: row.icon,
        count: row.count,
        amount: toYuan(toCents(row.amount)),
        createdAt: toIso(row.created_at),
      })),
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    };
  }
}
