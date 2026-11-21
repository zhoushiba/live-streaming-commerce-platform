import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../../../config/app-config';
import { BizErrors } from '../../../common/errors/business.exception';
import { formatMoney } from '../../../common/utils/money.util';
import {
  CreatePaymentInput,
  CreatedPayment,
  NotifyInput,
  PaymentProvider,
  QueryPaymentResult,
  RefundInput,
  RefundResult,
  VerifiedNotify,
} from '../payment.types';

/**
 * Mock 渠道：演示与自动化测试的主路径。
 * 不发起任何网络请求，用 HMAC-SHA256 + 时间戳窗口模拟「渠道签名 + 防重放」，
 * 报文结构与真实渠道一致：验签成功后才允许进入结算事务。
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly code = 'mock' as const;
  readonly displayName = '模拟支付（Mock，无需真实商户号）';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private sign(fields: Record<string, string>): string {
    const message = this.canonical(fields);
    return createHmac('sha256', this.config.pay.mock.secret).update(message).digest('hex');
  }

  private canonical(fields: Record<string, string>): string {
    return [
      'mock',
      fields.outTradeNo,
      fields.amount,
      fields.status,
      fields.timestamp,
      fields.nonce,
      fields.providerTradeNo ?? '',
    ].join('\n');
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(8).toString('hex');
    const providerTradeNo = `MOCK${Date.now()}${randomBytes(3).toString('hex')}`;
    const amount = formatMoney(input.amount);
    const fields = { outTradeNo: input.outTradeNo, amount, status: 'success', timestamp, nonce, providerTradeNo };
    const mockNotifyBody = { ...fields, signature: this.sign(fields) };
    return {
      provider: 'mock',
      outTradeNo: input.outTradeNo,
      amount: input.amount,
      payParams: {
        mockPayUrl: `${this.config.publicWebUrl}/pay/mock?outTradeNo=${encodeURIComponent(input.outTradeNo)}`,
        notifyUrl: `${this.config.publicWebUrl.replace(/:\d+$/, ':3000')}/api/payments/mock/notify`,
        outTradeNo: input.outTradeNo,
        amount,
      },
      raw: { providerTradeNo, sandbox: true },
      mockNotifyBody,
      sandboxNotice:
        'Mock 渠道不会产生真实扣款。把 mockNotifyBody 原样 POST 到 /api/payments/mock/notify 即可完成支付（重复 POST 验证幂等）。',
    };
  }

  async verifyNotify(input: NotifyInput): Promise<VerifiedNotify> {
    const body = input.body ?? {};
    const outTradeNo = String(body.outTradeNo ?? '');
    const amount = String(body.amount ?? '');
    const status = String(body.status ?? '');
    const timestamp = String(body.timestamp ?? '');
    const nonce = String(body.nonce ?? '');
    const providerTradeNo = String(body.providerTradeNo ?? '');
    const signature = String(body.signature ?? '');
    if (!outTradeNo || !amount || !timestamp || !nonce || !signature) {
      throw BizErrors.paymentSignatureInvalid('Mock 回调缺少必要字段');
    }
    const ts = Number(timestamp);
    const ttlSeconds = this.config.pay.mock.ttlMinutes * 60;
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > ttlSeconds) {
      throw BizErrors.paymentSignatureInvalid('回调时间戳超出允许窗口（防重放）');
    }
    const expected = this.sign({ outTradeNo, amount: formatMoney(amount), status, timestamp, nonce, providerTradeNo });
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw BizErrors.paymentSignatureInvalid('Mock 回调签名校验失败');
    }
    if (status !== 'success') {
      return {
        outTradeNo,
        providerTradeNo: providerTradeNo || `MOCK-FAILED-${outTradeNo}`,
        amount: Number(formatMoney(amount)),
        status: 'failed',
        paidAt: new Date(ts * 1000),
        rawPayload: body,
      };
    }
    return {
      outTradeNo,
      providerTradeNo: providerTradeNo || `MOCK-${outTradeNo}`,
      amount: Number(formatMoney(amount)),
      status: 'success',
      paidAt: new Date(ts * 1000),
      rawPayload: body,
    };
  }

  async queryPayment(outTradeNo: string): Promise<QueryPaymentResult> {
    // Mock 渠道无远端状态，真实状态以本地 payment_transaction 为准
    return { outTradeNo, status: 'unknown', raw: { note: 'Mock 渠道以本地流水表为准' } };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      accepted: true,
      providerRefundNo: `MOCKREFUND${Date.now()}`,
      raw: { sandbox: true, refundNo: input.refundNo, amount: formatMoney(input.amount), reason: input.reason },
    };
  }
}
