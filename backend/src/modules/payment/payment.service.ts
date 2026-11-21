import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { KNEX } from '../../database/knex.factory';
import { TABLES } from '../../database/schema';
import { AuthUser } from '../../common/decorators/auth.decorators';
import { BizError, BizErrors } from '../../common/errors/business.exception';
import { ErrorCode } from '../../common/errors/error-code';
import { generateOutTradeNo, generateRefundNo } from '../../common/utils/id.util';
import { amountEquals, formatMoney, round2 } from '../../common/utils/money.util';
import { EntitlementService } from '../entitlement/entitlement.service';
import { OrderService } from '../order/order.service';
import { PaymentKeyService } from './payment-key.service';
import { MockPaymentProvider } from './providers/mock.provider';
import { WechatPayProvider } from './providers/wechat.provider';
import { AlipayProvider } from './providers/alipay.provider';
import { CreatePaymentDto, PaymentProviderCode } from './dto/payment.dto';
import {
  CreatedPayment,
  NotifyInput,
  PaymentProvider,
  QueryPaymentResult,
  VerifiedNotify,
} from './payment.types';

export interface NotifyOutcome {
  provider: PaymentProviderCode;
  /** 是否已成功入账（含重复回调） */
  success: boolean;
  /** 是否命中幂等：本次没有重复发货 */
  duplicate: boolean;
  outTradeNo: string;
  orderNo?: string;
  amount?: number;
  granted?: string[];
  message: string;
}

/**
 * 支付编排层：
 * 1) 下单：校验订单归属/金额 → 调用渠道 → 落支付流水
 * 2) 回调：验签（渠道实现）→ 金额比对 → 【事务】CAS 支付流水 + CAS 订单 + 发放权益/充值
 * 3) 退款：渠道退款 → 【事务】订单 refunded + 退款单 + 撤销权益/扣回余额
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly orderService: OrderService,
    private readonly entitlement: EntitlementService,
    private readonly keys: PaymentKeyService,
    private readonly mock: MockPaymentProvider,
    private readonly wechat: WechatPayProvider,
    private readonly alipay: AlipayProvider,
  ) {}

  listProviders(): Array<{ code: PaymentProviderCode; displayName: string; sandbox: boolean; notice: string }> {
    return [
      {
        code: 'mock',
        displayName: this.mock.displayName,
        sandbox: true,
        notice: '本地 HMAC-SHA256 仿真渠道，回调报文可直接 curl 重放用于幂等演示',
      },
      {
        code: 'wechat',
        displayName: this.wechat.displayName,
        sandbox: this.config.pay.wechat.mode !== 'live',
        notice:
          this.config.pay.wechat.mode !== 'live'
            ? '沙箱：RSA 签名 / AES-256-GCM 回调解密均为真实实现，但不请求微信服务器'
            : '生产：直连 api.mch.weixin.qq.com',
      },
      {
        code: 'alipay',
        displayName: this.alipay.displayName,
        sandbox: this.config.pay.alipay.mode !== 'live',
        notice:
          this.config.pay.alipay.mode !== 'live'
            ? '沙箱：RSA2 签名真实，orderStr 可直接验签'
            : '生产：直连 openapi.alipay.com',
      },
    ];
  }

  getProvider(code: string): PaymentProvider {
    switch (code) {
      case 'mock':
        return this.mock;
      case 'wechat':
        return this.wechat;
      case 'alipay':
        return this.alipay;
      default:
        throw BizErrors.paymentProviderInvalid(`不支持的支付渠道：${code}`);
    }
  }

  async createPayment(
    user: AuthUser,
    dto: CreatePaymentDto,
  ): Promise<CreatedPayment & { orderNo: string; orderAmount: number; expireAt: string }> {
    const provider = this.getProvider(dto.provider);
    const order = await this.knex(TABLES.order)
      .where({ order_no: dto.orderNo, user_id: user.id })
      .first();
    if (!order) throw BizErrors.notFound('订单不存在');
    if (order.status === 'paid') throw BizErrors.orderStateInvalid('订单已支付，无需重复发起');
    if (order.status === 'closed') throw BizErrors.orderExpired();
    if (new Date(order.expire_at).getTime() <= Date.now()) {
      await this.orderService.closeExpiredOrders(1);
      throw BizErrors.orderExpired();
    }

    const outTradeNo = generateOutTradeNo(provider.code);
    const created = await provider.createPayment({
      outTradeNo,
      orderNo: order.order_no,
      amount: round2(order.amount),
      description: `直播电商平台-${order.biz_type}-${order.order_no}`,
      openId: dto.openId,
    });

    await this.knex(TABLES.paymentTransaction).insert({
      out_trade_no: outTradeNo,
      order_no: order.order_no,
      provider: provider.code,
      trade_type: provider.code === 'wechat' ? 'JSAPI' : provider.code === 'alipay' ? 'PAGE' : 'MOCK',
      amount: round2(order.amount),
      status: 'pending',
      notify_payload: created.raw ? JSON.stringify(created.raw) : null,
      updated_at: new Date(),
    });

    this.logger.log(`创建支付单 user=${user.id} order=${order.order_no} provider=${provider.code} outTradeNo=${outTradeNo}`);
    return {
      ...created,
      orderNo: order.order_no,
      orderAmount: round2(order.amount),
      expireAt: new Date(order.expire_at).toISOString(),
    };
  }

  /** 第三方异步回调入口：验签 → 金额校验 → 事务结算（幂等） */
  async handleNotify(providerCode: string, input: NotifyInput): Promise<NotifyOutcome> {
    const provider = this.getProvider(providerCode);
    const verified: VerifiedNotify = await provider.verifyNotify(input);

    const tx = await this.knex(TABLES.paymentTransaction)
      .where({ out_trade_no: verified.outTradeNo })
      .first();
    if (!tx) throw BizErrors.notFound(`支付流水不存在：${verified.outTradeNo}`);
    if (!amountEquals(tx.amount, verified.amount)) {
      this.logger.error(`回调金额不一致 outTradeNo=${verified.outTradeNo} local=${tx.amount} channel=${verified.amount}`);
      throw BizErrors.paymentAmountMismatch();
    }

    if (verified.status !== 'success') {
      await this.knex(TABLES.paymentTransaction)
        .where({ id: tx.id, status: 'pending' })
        .update({ status: 'failed', notify_payload: JSON.stringify(verified.rawPayload), updated_at: new Date() });
      return {
        provider: provider.code,
        success: true,
        duplicate: false,
        outTradeNo: verified.outTradeNo,
        orderNo: tx.order_no,
        message: '非成功状态已记录，未发货',
      };
    }

    const settled = await this.knex.transaction(async (trx) => this.settle(trx, tx, verified));
    return {
      provider: provider.code,
      success: true,
      duplicate: settled.duplicate,
      outTradeNo: verified.outTradeNo,
      orderNo: settled.orderNo,
      amount: round2(tx.amount),
      granted: settled.granted,
      message: settled.duplicate ? '重复回调：已幂等忽略，无重复发货' : '结算成功，权益已发放',
    };
  }

  /**
   * 结算事务（幂等的核心）：
   * - payment_transaction 用 `WHERE status='pending'` 做原子 CAS，第二个并发回调影响行数为 0 → 直接返回幂等
   * - 订单同样用 CAS，避免重复置 paid
   * - 权益/余额在同一事务内发放，任一步失败全部回滚，回调重试即可
   */
  private async settle(
    trx: Knex.Transaction,
    tx: Record<string, any>,
    verified: VerifiedNotify,
  ): Promise<{ duplicate: boolean; orderNo: string; granted: string[] }> {
    const now = new Date();
    const affected = await trx(TABLES.paymentTransaction)
      .where({ id: tx.id, status: 'pending' })
      .update({
        status: 'success',
        provider_trade_no: verified.providerTradeNo,
        paid_at: verified.paidAt ?? now,
        notify_payload: JSON.stringify(verified.rawPayload),
        updated_at: now,
      });
    if (affected === 0) {
      const current = await trx(TABLES.paymentTransaction).where({ id: tx.id }).first();
      this.logger.log(`幂等命中 outTradeNo=${tx.out_trade_no} 当前状态=${current?.status}`);
      return { duplicate: true, orderNo: tx.order_no, granted: [] };
    }

    let order = await trx(TABLES.order).where({ order_no: tx.order_no }).first();
    if (!order) throw BizErrors.notFound('订单不存在');

    let transitioned = false;
    try {
      const paid = await this.orderService.markPaid(trx, order.order_no);
      order = paid.order;
      transitioned = paid.transitioned;
    } catch (error) {
      // 支付成功后订单才超时关单：补记为已支付，避免用户钱付了没权益
      if (error instanceof BizError && error.bizCode === ErrorCode.ORDER_EXPIRED) {
        const late = await trx(TABLES.order)
          .where({ order_no: order.order_no, status: 'closed' })
          .update({ status: 'paid', paid_at: now, remark: '超时支付补单' });
        transitioned = late > 0;
        order = await trx(TABLES.order).where({ order_no: order.order_no }).first();
      } else {
        throw error;
      }
    }

    if (!transitioned) {
      return { duplicate: true, orderNo: order.order_no, granted: [] };
    }

    const granted = await this.grantForOrder(trx, order);
    return { duplicate: false, orderNo: order.order_no, granted };
  }

  /** 按订单类型发放权益 / 充值余额（与结算同事务） */
  private async grantForOrder(trx: Knex.Transaction, order: Record<string, any>): Promise<string[]> {
    const granted: string[] = [];
    if (order.biz_type === 'recharge') {
      await this.creditWallet(trx, order, `充值订单 ${order.order_no}`);
      granted.push(`wallet:+${formatMoney(order.amount)}`);
      return granted;
    }
    if (order.biz_type === 'room') {
      const room = await trx(TABLES.liveRoom).where({ id: order.target_id }).first();
      if (!room) throw BizErrors.notFound('直播间不存在，无法发放权益');
      const days = room.price_type === 'monthly' ? 31 : room.price_type === 'yearly' ? 366 : null;
      await this.entitlement.grant(trx, {
        userId: order.user_id,
        targetType: 'room',
        targetId: Number(order.target_id),
        orderId: Number(order.id),
        source: 'order',
        durationDays: days,
      });
      granted.push(`room:${order.target_id}${days ? `+${days}d` : '(永久)'}`);
      return granted;
    }
    if (order.biz_type === 'video') {
      await this.entitlement.grant(trx, {
        userId: order.user_id,
        targetType: 'video',
        targetId: Number(order.target_id),
        orderId: Number(order.id),
        source: 'order',
        durationDays: null,
      });
      granted.push(`video:${order.target_id}(永久)`);
      return granted;
    }
    return granted;
  }

  /** 钱包入账：biz_no 唯一索引保证同一订单只入账一次 */
  private async creditWallet(trx: Knex.Transaction, order: Record<string, any>, remark: string): Promise<void> {
    const bizNo = `recharge:${order.order_no}`;
    const exists = await trx(TABLES.balanceTransaction).where({ biz_no: bizNo }).first();
    if (exists) return;
    const amount = round2(order.amount);
    const updated = await trx(TABLES.userBalance)
      .where({ user_id: order.user_id })
      .update({
        balance: trx.raw('balance + ?', [amount]),
        total_recharge: trx.raw('total_recharge + ?', [amount]),
        version: trx.raw('version + 1'),
        updated_at: new Date(),
      });
    if (updated === 0) {
      await trx(TABLES.userBalance).insert({
        user_id: order.user_id,
        balance: amount,
        total_recharge: amount,
        total_consume: 0,
        updated_at: new Date(),
      });
    }
    const wallet = await trx(TABLES.userBalance).where({ user_id: order.user_id }).first();
    await trx(TABLES.balanceTransaction).insert({
      user_id: order.user_id,
      biz_type: 'recharge',
      amount,
      balance_after: round2(wallet?.balance ?? amount),
      biz_no: bizNo,
      remark,
    });
  }

  async queryPayment(user: AuthUser, outTradeNo: string): Promise<Record<string, unknown>> {
    const tx = await this.knex(TABLES.paymentTransaction).where({ out_trade_no: outTradeNo }).first();
    if (!tx) throw BizErrors.notFound('支付流水不存在');
    const orders = await this.knex(TABLES.order).where({ order_no: tx.order_no }).first();
    if (!orders || Number(orders.user_id) !== user.id) throw BizErrors.forbidden('无权查看该支付单');
    let remote: QueryPaymentResult | null = null;
    try {
      remote = await this.getProvider(tx.provider).queryPayment(outTradeNo);
    } catch (error) {
      this.logger.warn(`渠道查询失败：${(error as Error).message}`);
    }
    return {
      outTradeNo,
      orderNo: tx.order_no,
      provider: tx.provider,
      amount: round2(tx.amount),
      status: tx.status,
      providerTradeNo: tx.provider_trade_no,
      paidAt: tx.paid_at ? new Date(tx.paid_at).toISOString() : null,
      createdAt: new Date(tx.created_at).toISOString(),
      remote,
    };
  }

  /**
   * 退款（第 3 处事务）：
   * CAS 订单 paid → refunded 抢到退款权 → 写退款单 → 撤销权益 / 扣回充值余额 → 支付流水置 refunded
   * 渠道退款放在事务外先执行，失败直接抛错，避免出现“本地已退款、渠道未退”的不一致。
   */
  async refund(operator: AuthUser, orderNo: string, reason: string): Promise<Record<string, unknown>> {
    const order = await this.knex(TABLES.order).where({ order_no: orderNo }).first();
    if (!order) throw BizErrors.notFound('订单不存在');
    if (order.status !== 'paid') throw BizErrors.orderStateInvalid('仅已支付订单可退款');
    const tx = await this.knex(TABLES.paymentTransaction)
      .where({ order_no: orderNo, status: 'success' })
      .first();
    if (!tx) throw BizErrors.notFound('未找到成功的支付流水');

    const refundNo = generateRefundNo();
    const channel = await this.getProvider(tx.provider).refund({
      outTradeNo: tx.out_trade_no,
      refundNo,
      orderNo,
      amount: round2(tx.amount),
      reason,
    });
    if (!channel.accepted) {
      throw BizErrors.paymentChannelError(`渠道退款失败：${JSON.stringify(channel.raw ?? {})}`);
    }

    await this.knex.transaction(async (trx) => {
      const affected = await trx(TABLES.order)
        .where({ order_no: orderNo, status: 'paid' })
        .update({ status: 'refunded', remark: reason.slice(0, 200), updated_at: new Date() });
      if (affected === 0) throw BizErrors.orderStateInvalid('订单状态已变化，退款未执行');

      await trx(TABLES.refundRecord).insert({
        refund_no: refundNo,
        order_no: orderNo,
        payment_tx_id: tx.id,
        amount: round2(tx.amount),
        reason,
        status: 'success',
        operator_id: operator.id,
        provider_refund_no: channel.providerRefundNo ?? null,
        updated_at: new Date(),
      });
      await trx(TABLES.paymentTransaction)
        .where({ id: tx.id })
        .update({ status: 'refunded', updated_at: new Date() });

      if (order.biz_type === 'recharge') {
        const amount = round2(tx.amount);
        const debited = await trx(TABLES.userBalance)
          .where({ user_id: order.user_id })
          .andWhere('balance', '>=', amount)
          .update({
            balance: trx.raw('balance - ?', [amount]),
            total_recharge: trx.raw('total_recharge - ?', [amount]),
            version: trx.raw('version + 1'),
            updated_at: new Date(),
          });
        if (debited === 0) throw BizErrors.insufficientBalance('余额不足以冲正本次充值，请联系客服');
        const wallet = await trx(TABLES.userBalance).where({ user_id: order.user_id }).first();
        await trx(TABLES.balanceTransaction).insert({
          user_id: order.user_id,
          biz_type: 'refund',
          amount: -amount,
          balance_after: round2(wallet?.balance ?? 0),
          biz_no: `refund:${refundNo}`,
          remark: `充值退款 ${orderNo}`,
        });
      } else {
        await this.entitlement.revokeByOrder(trx, Number(order.id));
      }
    });

    this.logger.log(`退款完成 order=${orderNo} refundNo=${refundNo} by=${operator.id}`);
    return {
      refundNo,
      orderNo,
      amount: round2(tx.amount),
      provider: tx.provider,
      providerRefundNo: channel.providerRefundNo ?? null,
      status: 'success',
    };
  }

  /** 对账：本地成功流水 vs 渠道（沙箱渠道无账单，视为一致），写 reconciliation_log */
  async reconcile(billDate: string, providerCode: PaymentProviderCode): Promise<Record<string, unknown>> {
    const provider = this.getProvider(providerCode);
    const start = new Date(`${billDate}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const rows = await this.knex(TABLES.paymentTransaction)
      .where({ provider: providerCode, status: 'success' })
      .where('paid_at', '>=', start)
      .andWhere('paid_at', '<', end);

    let totalLocal = 0;
    let totalChannel = 0;
    let diffCount = 0;
    const diffs: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const local = round2(row.amount);
      totalLocal += local;
      let channelAmount = local;
      try {
        const remote = await provider.queryPayment(row.out_trade_no);
        if (remote.status === 'success' && remote.amount !== undefined) channelAmount = round2(remote.amount);
      } catch {
        channelAmount = local;
      }
      totalChannel += channelAmount;
      if (!amountEquals(local, channelAmount)) {
        diffCount += 1;
        diffs.push({ outTradeNo: row.out_trade_no, local, channel: channelAmount });
      }
    }

    const summary = {
      billDate,
      provider: providerCode,
      localCount: rows.length,
      channelCount: rows.length,
      totalLocal: formatMoney(totalLocal),
      totalChannel: formatMoney(totalChannel),
      diffCount,
      diffs,
    };
    await this.knex(TABLES.reconciliationLog)
      .insert({
        bill_date: billDate,
        provider: providerCode,
        total_local: summary.totalLocal,
        total_channel: summary.totalChannel,
        local_count: summary.localCount,
        channel_count: summary.channelCount,
        diff_count: diffCount,
        detail_json: JSON.stringify({ diffs, generatedAt: new Date().toISOString() }),
      })
      .onConflict(['bill_date', 'provider'])
      .merge();
    return summary;
  }

  async listReconciliations(limit = 30): Promise<Record<string, any>[]> {
    const rows = await this.knex(TABLES.reconciliationLog).orderBy('bill_date', 'desc').limit(limit);
    return rows.map((row) => ({
      billDate: row.bill_date,
      provider: row.provider,
      totalLocal: round2(row.total_local),
      totalChannel: round2(row.total_channel),
      localCount: row.local_count,
      channelCount: row.channel_count,
      diffCount: row.diff_count,
      detail: row.detail_json ? JSON.parse(row.detail_json) : null,
    }));
  }
}
