import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../../database/knex.factory';
import { TABLES } from '../../database/schema';
import { BizErrors } from '../../common/errors/business.exception';
import { buildPage, PageResult } from '../../common/dto/pagination.dto';
import { round2 } from '../../common/utils/money.util';
import { DanmakuService } from '../danmaku/danmaku.service';
import { LiveGateway } from '../danmaku/live.gateway';
import { PaymentService } from '../payment/payment.service';
import { PaymentProviderCode } from '../payment/dto/payment.dto';

@Injectable()
export class AdminService {
  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly danmaku: DanmakuService,
    private readonly gateway: LiveGateway,
    private readonly payment: PaymentService,
  ) {}

  /** 运营看板：一次并行查询出核心指标 */
  async stats(): Promise<Record<string, unknown>> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const count = async (builder: Knex.QueryBuilder): Promise<number> => {
      const [row] = await builder.count<{ total: number }[]>({ total: '*' });
      return Number(row?.total ?? 0);
    };
    const sum = async (builder: Knex.QueryBuilder): Promise<number> => {
      const [row] = await builder.sum<{ total: number | null }[]>({ total: 'amount' });
      return round2(row?.total ?? 0);
    };

    const [
      userTotal,
      userToday,
      roomTotal,
      roomLiving,
      orderTotal,
      orderToday,
      paidToday,
      revenueToday,
      danmakuToday,
      giftRevenueToday,
    ] = await Promise.all([
      count(this.knex(TABLES.user)),
      count(this.knex(TABLES.user).where('created_at', '>=', startOfToday)),
      count(this.knex(TABLES.liveRoom)),
      count(this.knex(TABLES.liveRoom).where('status', 'living')),
      count(this.knex(TABLES.order)),
      count(this.knex(TABLES.order).where('created_at', '>=', startOfToday)),
      count(this.knex(TABLES.order).where({ status: 'paid' }).andWhere('paid_at', '>=', startOfToday)),
      sum(this.knex(TABLES.order).where({ status: 'paid' }).andWhere('paid_at', '>=', startOfToday)),
      count(this.knex(TABLES.danmaku).where('created_at', '>=', startOfToday)),
      sum(this.knex(TABLES.giftRecord).where('created_at', '>=', startOfToday)),
    ]);

    const providers = await this.knex(TABLES.paymentTransaction)
      .where('created_at', '>=', startOfToday)
      .groupBy('provider')
      .select('provider')
      .count<{ provider: string; count: number }[]>({ count: '*' });

    return {
      users: { total: userTotal, today: userToday },
      rooms: { total: roomTotal, living: roomLiving },
      orders: { total: orderTotal, today: orderToday, paidToday, revenueToday },
      revenue: { orderToday: revenueToday, giftToday: giftRevenueToday },
      danmakuToday,
      paymentChannels: providers.map((row) => ({ provider: row.provider, count: Number(row.count) })),
      generatedAt: new Date().toISOString(),
    };
  }

  async listUsers(page: number, pageSize: number, keyword?: string): Promise<PageResult<Record<string, unknown>>> {
    const base = this.knex(TABLES.user).select('*');
    if (keyword) base.andWhere((qb) => qb.where('username', 'like', `%${keyword}%`).orWhere('nickname', 'like', `%${keyword}%`));
    const [{ total }] = await base.clone().clearSelect().count<{ total: number }[]>({ total: '*' });
    const rows = await base
      .clone()
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const balances = rows.length
      ? await this.knex(TABLES.userBalance).whereIn('user_id', rows.map((row) => row.id))
      : [];
    const balanceMap = new Map(balances.map((row) => [Number(row.user_id), round2(row.balance)]));
    return buildPage(
      rows.map((row) => ({
        id: Number(row.id),
        username: row.username,
        nickname: row.nickname,
        role: row.role,
        status: row.status,
        balance: balanceMap.get(Number(row.id)) ?? 0,
        lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      Number(total),
      page,
      pageSize,
    );
  }

  async setUserStatus(operatorId: number, userId: number, status: 'active' | 'disabled'): Promise<Record<string, unknown>> {
    if (operatorId === userId && status === 'disabled') {
      throw BizErrors.invalidParameter('不能禁用当前登录的管理员账号');
    }
    const affected = await this.knex(TABLES.user).where({ id: userId }).update({ status, updated_at: new Date() });
    if (affected === 0) throw BizErrors.notFound('用户不存在');
    return { userId, status };
  }

  async listOrders(page: number, pageSize: number, status?: string): Promise<PageResult<Record<string, unknown>>> {
    const base = this.knex(TABLES.order + ' as o')
      .leftJoin(TABLES.user + ' as u', 'u.id', 'o.user_id')
      .select('o.*', 'u.username', 'u.nickname');
    if (status) base.andWhere('o.status', status);
    const [{ total }] = await base.clone().clearSelect().count<{ total: number }[]>({ total: '*' });
    const rows = await base
      .clone()
      .orderBy('o.created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return buildPage(
      rows.map((row) => ({
        orderNo: row.order_no,
        userId: Number(row.user_id),
        username: row.username,
        nickname: row.nickname,
        bizType: row.biz_type,
        targetId: row.target_id,
        amount: round2(row.amount),
        status: row.status,
        paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      Number(total),
      page,
      pageSize,
    );
  }

  async listRooms(page: number, pageSize: number, status?: string): Promise<PageResult<Record<string, unknown>>> {
    const base = this.knex(TABLES.liveRoom + ' as r')
      .leftJoin(TABLES.anchor + ' as a', 'a.id', 'r.anchor_id')
      .select('r.*', 'a.display_name');
    if (status) base.andWhere('r.status', status);
    const [{ total }] = await base.clone().clearSelect().count<{ total: number }[]>({ total: '*' });
    const rows = await base
      .clone()
      .orderBy('r.viewers', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return buildPage(
      rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        anchorId: Number(row.anchor_id),
        anchorName: row.display_name,
        status: row.status,
        priceType: row.price_type,
        price: round2(row.price),
        viewers: row.viewers,
        peakViewers: row.peak_viewers,
        streamKey: row.stream_key,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      Number(total),
      page,
      pageSize,
    );
  }

  /** 管理员强制下播：直接置 ended 并广播 live:status */
  async forceEndLive(roomId: number): Promise<Record<string, unknown>> {
    const affected = await this.knex(TABLES.liveRoom)
      .where({ id: roomId, status: 'living' })
      .update({ status: 'ended', ended_at: new Date(), updated_at: new Date() });
    if (affected === 0) throw BizErrors.roomInvalidState('直播间未在直播中');
    this.gateway.broadcastLiveStatus(roomId, 'ended');
    return { roomId, status: 'ended' };
  }

  async hideDanmaku(danmakuId: number, operatorId: number): Promise<Record<string, unknown>> {
    return this.danmaku.hide(danmakuId, operatorId);
  }

  async reconcile(billDate: string, provider: PaymentProviderCode): Promise<Record<string, unknown>> {
    return this.payment.reconcile(billDate, provider);
  }

  async listReconciliations(limit = 30): Promise<Record<string, unknown>[]> {
    return this.payment.listReconciliations(limit);
  }
}
