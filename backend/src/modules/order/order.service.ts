import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../../database/knex.factory';
import { OrderBizType, OrderStatus, TABLES } from '../../database/schema';
import { BizErrors } from '../../common/errors/business.exception';
import { AuthUser } from '../../common/decorators/auth.decorators';
import { buildPage } from '../../common/dto/pagination.dto';
import { generateOrderNo, isUniqueViolation } from '../../common/utils/id.util';
import { toCents, toYuan } from '../../common/utils/money.util';
import { toDate, toIso } from '../../common/utils/time.util';
import { CreateOrderDto, ListOrdersQuery } from './dto/order.dto';

/** 订单支付有效期：15 分钟，超时由定时任务关单 */
export const ORDER_TTL_MINUTES = 15;

export interface OrderView {
  id: number;
  orderNo: string;
  bizType: OrderBizType;
  targetId: number | null;
  amount: number;
  status: OrderStatus;
  title: string;
  expireAt: string | null;
  paidAt: string | null;
  closedAt: string | null;
  createdAt: string | null;
  idempotent: boolean;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(@Inject(KNEX) private readonly db: Knex) {}

  /**
   * 下单：
   * 1) 金额只以服务端内容定价为准；
   * 2) idempotencyKey 唯一索引兜底，重复提交返回同一订单（不重复扣款/发权益）。
   */
  async createOrder(user: AuthUser, dto: CreateOrderDto): Promise<OrderView> {
    const existing = await this.db(TABLES.order).where({ idempotency_key: dto.idempotencyKey }).first();
    if (existing) {
      if (existing.user_id !== user.id) {
        throw BizErrors.orderStateInvalid('该幂等键已被其他用户使用');
      }
      return this.toView(existing, true, await this.itemTitle(existing.id));
    }

    const resolved = await this.resolvePrice(dto);
    const now = new Date();
    const expireAt = new Date(now.getTime() + ORDER_TTL_MINUTES * 60 * 1000);

    try {
      const orderId = await this.db.transaction(async (trx) => {
        const [id] = await trx(TABLES.order).insert({
          order_no: generateOrderNo(),
          user_id: user.id,
          biz_type: resolved.bizType,
          target_id: resolved.targetId,
          amount: resolved.amount,
          status: 'pending',
          idempotency_key: dto.idempotencyKey,
          expire_at: expireAt,
          remark: resolved.remark,
          created_at: now,
          updated_at: now,
        });
        await trx(TABLES.orderItem).insert({
          order_id: id,
          title: resolved.title,
          item_type: resolved.bizType,
          item_id: resolved.targetId,
          price: resolved.amount,
          quantity: 1,
        });
        return id as number;
      });
      const row = await this.db(TABLES.order).where({ id: orderId }).first();
      const item = await this.db(TABLES.orderItem).where({ order_id: orderId }).first();
      return this.toView(row, false, item?.title);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const row = await this.db(TABLES.order).where({ idempotency_key: dto.idempotencyKey }).first();
        if (row) return this.toView(row, true, await this.itemTitle(row.id));
      }
      throw error;
    }
  }

  private async resolvePrice(dto: CreateOrderDto): Promise<{
    bizType: OrderBizType;
    targetId: number | null;
    amount: number;
    title: string;
    remark: string;
  }> {
    if (dto.bizType === 'recharge') {
      const amount = Number(dto.amount ?? 0);
      if (!(amount > 0)) throw BizErrors.invalidParameter('充值金额必须大于 0');
      return {
        bizType: 'recharge',
        targetId: null,
        amount: toYuan(toCents(amount)),
        title: `账户充值 ¥${amount.toFixed(2)}`,
        remark: '余额充值',
      };
    }

    if (dto.bizType === 'room') {
      if (!dto.targetId) throw BizErrors.invalidParameter('缺少直播间 ID');
      const room = await this.db(TABLES.liveRoom).where({ id: dto.targetId }).first();
      if (!room) throw BizErrors.notFound('直播间不存在');
      if (room.price_type === 'free' || Number(room.price) <= 0) {
        throw BizErrors.invalidParameter('该直播间免费，无需购买');
      }
      return {
        bizType: 'room',
        targetId: room.id,
        amount: toYuan(toCents(room.price)),
        title: `直播间会员：${room.title}`,
        remark: room.price_type,
      };
    }

    if (!dto.targetId) throw BizErrors.invalidParameter('缺少视频集 ID');
    const episode = await this.db(TABLES.videoEpisode).where({ id: dto.targetId }).first();
    if (!episode) throw BizErrors.notFound('视频集不存在');
    if (episode.free) throw BizErrors.invalidParameter('该集免费，无需购买');
    const video = await this.db(TABLES.video).where({ id: episode.video_id }).first();
    if (!video) throw BizErrors.notFound('视频不存在');
    if (Number(video.price) <= 0) throw BizErrors.invalidParameter('该视频未定价，无法购买');
    return {
      bizType: 'video',
      targetId: episode.id,
      amount: toYuan(toCents(video.price)),
      title: `点播：${video.title} 第${episode.episode_no}集`,
      remark: `video:${video.id}`,
    };
  }

  /** 订单条目标题（同一订单通常只有 1 个条目；remark 存的是业务标记，不能当标题用） */
  private async itemTitle(orderId: number): Promise<string | null> {
    const item = await this.db(TABLES.orderItem).where({ order_id: orderId }).first();
    return item?.title ?? null;
  }

  private toView(row: Record<string, any>, idempotent: boolean, itemTitle?: string | null): OrderView {
    return {
      id: Number(row.id),
      orderNo: row.order_no,
      bizType: row.biz_type as OrderBizType,
      targetId: row.target_id ?? null,
      amount: toYuan(toCents(row.amount)),
      status: row.status as OrderStatus,
      title: itemTitle ?? row.remark ?? '',
      expireAt: toIso(row.expire_at),
      paidAt: toIso(row.paid_at),
      closedAt: toIso(row.closed_at),
      createdAt: toIso(row.created_at),
      idempotent,
    };
  }

  async listMyOrders(user: AuthUser, query: ListOrdersQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const base = this.db(TABLES.order + ' as o').where('o.user_id', user.id);
    if (query.status) base.andWhere('o.status', query.status);
    const countRow = await base.clone().count<{ total: number }[]>({ total: '*' }).first();
    const rows = await base
      .clone()
      .leftJoin(TABLES.orderItem + ' as i', 'i.order_id', 'o.id')
      .leftJoin(TABLES.paymentTransaction + ' as p', 'p.order_no', 'o.order_no')
      .select(
        'o.*',
        'i.title as item_title',
        'p.provider as pay_provider',
        'p.status as pay_status',
        'p.out_trade_no',
      )
      .orderBy('o.id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return buildPage(
      rows.map((row) => ({
        orderNo: row.order_no,
        bizType: row.biz_type,
        targetId: row.target_id,
        amount: toYuan(toCents(row.amount)),
        status: row.status,
        title: row.item_title ?? '',
        payProvider: row.pay_provider ?? null,
        payStatus: row.pay_status ?? null,
        outTradeNo: row.out_trade_no ?? null,
        createdAt: toIso(row.created_at),
        paidAt: toIso(row.paid_at),
        expireAt: toIso(row.expire_at),
      })),
      Number(countRow?.total ?? 0),
      page,
      pageSize,
    );
  }

  async findByOrderNo(orderNo: string) {
    return this.db(TABLES.order).where({ order_no: orderNo }).first();
  }

  async getOrderDetail(user: AuthUser, orderNo: string) {
    const order = await this.db(TABLES.order).where({ order_no: orderNo }).first();
    if (!order) throw BizErrors.notFound('订单不存在');
    if (order.user_id !== user.id && user.role !== 'admin') throw BizErrors.forbidden('无权查看该订单');
    const items = await this.db(TABLES.orderItem).where({ order_id: order.id });
    const payment = await this.db(TABLES.paymentTransaction).where({ order_no: orderNo }).orderBy('id', 'desc').first();
    const entitlement = await this.db(TABLES.entitlement).where({ order_id: order.id }).first();
    return {
      ...this.toView(order, false, items[0]?.title),
      items: items.map((item) => ({
        title: item.title,
        itemType: item.item_type,
        itemId: item.item_id,
        price: toYuan(toCents(item.price)),
        quantity: item.quantity,
      })),
      payment: payment
        ? {
            provider: payment.provider,
            outTradeNo: payment.out_trade_no,
            status: payment.status,
            amount: toYuan(toCents(payment.amount)),
            paidAt: toIso(payment.paid_at),
          }
        : null,
      entitlement: entitlement
        ? {
            id: entitlement.id,
            targetType: entitlement.target_type,
            targetId: entitlement.target_id,
            status: entitlement.status,
            expireAt: toIso(entitlement.expire_at),
          }
        : null,
    };
  }

  /**
   * 支付成功落库：CAS（pending → paid）保证并发回调只成功一次。
   * 返回 { order, transitioned }，transitioned=false 表示此前已支付（幂等）。
   */
  async markPaid(
    trx: Knex.Transaction,
    orderNo: string,
  ): Promise<{ order: Record<string, any>; transitioned: boolean }> {
    const now = new Date();
    const affected = await trx(TABLES.order)
      .where({ order_no: orderNo, status: 'pending' })
      .update({ status: 'paid', paid_at: now, updated_at: now });
    const order = await trx(TABLES.order).where({ order_no: orderNo }).first();
    if (!order) throw BizErrors.notFound('订单不存在');
    if (Number(affected) > 0) return { order, transitioned: true };
    if (order.status === 'paid' || order.status === 'refunded') return { order, transitioned: false };
    if (order.status === 'closed') throw BizErrors.orderExpired();
    throw BizErrors.orderStateInvalid(`订单状态异常：${order.status}`);
  }

  /** 用户主动取消（仅 pending 可取消） */
  async cancelOrder(user: AuthUser, orderNo: string) {
    const order = await this.db(TABLES.order).where({ order_no: orderNo }).first();
    if (!order) throw BizErrors.notFound('订单不存在');
    if (order.user_id !== user.id) throw BizErrors.forbidden('无权操作该订单');
    const affected = await this.db(TABLES.order)
      .where({ order_no: orderNo, status: 'pending' })
      .update({ status: 'closed', closed_at: new Date(), updated_at: new Date() });
    if (Number(affected) === 0) throw BizErrors.orderStateInvalid('只有待支付订单可以取消');
    return { orderNo, status: 'closed' };
  }

  /** 定时任务：关闭超时未支付订单（走 idx_order_status_expire 索引） */
  async closeExpiredOrders(limit = 200): Promise<number> {
    const now = new Date();
    const rows = await this.db(TABLES.order)
      .where({ status: 'pending' })
      .andWhere('expire_at', '<', now)
      .limit(limit)
      .select('id', 'order_no');
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    const affected = await this.db(TABLES.order)
      .whereIn('id', ids)
      .andWhere('status', 'pending')
      .update({ status: 'closed', closed_at: now, updated_at: now });
    if (affected > 0) this.logger.log(`超时关单 ${affected} 笔`);
    return Number(affected ?? 0);
  }

  /** 统计：管理端看板 */
  async stats() {
    const [orderAgg] = await this.db(TABLES.order)
      .where({ status: 'paid' })
      .sum<{ total: number }[]>({ total: 'amount' });
    const pending = await this.db(TABLES.order).where({ status: 'pending' }).count<{ total: number }[]>({ total: '*' });
    const paid = await this.db(TABLES.order).where({ status: 'paid' }).count<{ total: number }[]>({ total: '*' });
    return {
      paidAmount: toYuan(toCents(orderAgg?.total ?? 0)),
      pendingCount: Number(pending?.[0]?.total ?? 0),
      paidCount: Number(paid?.[0]?.total ?? 0),
    };
  }

  /** 供支付模块校验订单是否可支付 */
  async assertPayable(orderNo: string, userId?: number) {
    const order = await this.db(TABLES.order).where({ order_no: orderNo }).first();
    if (!order) throw BizErrors.notFound('订单不存在');
    if (userId && order.user_id !== userId) throw BizErrors.forbidden('无权支付该订单');
    if (order.status === 'paid') throw BizErrors.orderStateInvalid('订单已支付');
    if (order.status === 'closed') throw BizErrors.orderExpired();
    if (order.status === 'refunded') throw BizErrors.orderStateInvalid('订单已退款');
    const expireAt = toDate(order.expire_at);
    if (expireAt && expireAt.getTime() < Date.now()) {
      await this.db(TABLES.order)
        .where({ order_no: orderNo, status: 'pending' })
        .update({ status: 'closed', closed_at: new Date(), updated_at: new Date() });
      throw BizErrors.orderExpired();
    }
    return order;
  }
}
