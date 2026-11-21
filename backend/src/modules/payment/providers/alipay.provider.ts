import { Inject, Injectable, Logger } from '@nestjs/common';
import { createSign, createVerify } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../../../config/app-config';
import { BizErrors } from '../../../common/errors/business.exception';
import { formatMoney } from '../../../common/utils/money.util';
import { PaymentKeyService } from '../payment-key.service';
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
 * 支付宝开放平台（RSA2）：
 * - 请求签名：待签串 = 参数按 key 升序拼接 k=v&...（排除 sign/sign_type/空值），SHA256withRSA
 * - 异步通知验签：用支付宝公钥对同一规则重建的待签串验签
 * - 页面支付（alipay.trade.page.pay）直接返回可提交的 orderStr；沙箱模式不发起网络请求
 */
@Injectable()
export class AlipayProvider implements PaymentProvider {
  readonly code = 'alipay' as const;
  readonly displayName = '支付宝（RSA2 电脑网站支付）';
  private readonly logger = new Logger(AlipayProvider.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly keys: PaymentKeyService,
  ) {}

  private get sandbox(): boolean {
    return this.config.pay.alipay.mode !== 'live';
  }

  private sign(content: string): string {
    const signer = createSign('RSA-SHA256');
    signer.update(content, 'utf8');
    signer.end();
    return signer.sign(this.keys.alipayApp().privateKey, 'base64');
  }

  private verify(content: string, signature: string): boolean {
    try {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(content, 'utf8');
      verifier.end();
      return verifier.verify(this.keys.alipayPlatform().publicKey, signature, 'base64');
    } catch (error) {
      this.logger.warn(`支付宝验签异常：${(error as Error).message}`);
      return false;
    }
  }

  private buildContent(params: Record<string, string>): string {
    return Object.keys(params)
      .filter((key) => key !== 'sign' && key !== 'sign_type' && params[key] !== undefined && params[key] !== '')
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
  }

  /** 支付宝要求 yyyy-MM-dd HH:mm:ss（东八区） */
  private timestamp(): string {
    const utc8 = new Date(Date.now() + 8 * 3600 * 1000);
    return utc8.toISOString().slice(0, 19).replace('T', ' ');
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const bizContent = JSON.stringify({
      out_trade_no: input.outTradeNo,
      total_amount: formatMoney(input.amount),
      subject: input.description.slice(0, 60),
      product_code: 'FAST_INSTANT_TRADE_PAY',
      timeout_express: `${this.config.pay.mock.ttlMinutes}m`,
    });
    const params: Record<string, string> = {
      app_id: this.config.pay.alipay.appId,
      method: 'alipay.trade.page.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.timestamp(),
      version: '1.0',
      notify_url: this.config.pay.alipay.notifyUrl,
      biz_content: bizContent,
    };
    const content = this.buildContent(params);
    const signature = this.sign(content);
    const paramsWithSign = { ...params, sign: signature };
    const orderStr = Object.keys(paramsWithSign)
      .sort()
      .map((key) => `${key}=${encodeURIComponent((paramsWithSign as Record<string, string>)[key])}`)
      .join('&');

    return {
      provider: 'alipay',
      outTradeNo: input.outTradeNo,
      amount: input.amount,
      payParams: {
        gateway: this.config.pay.alipay.gateway,
        method: params.method,
        orderStr,
        /** 前端可直接 form action=gateway method=POST 提交，或把 orderStr 拼到 gateway? 后跳转 */
        submitUrl: `${this.config.pay.alipay.gateway}?${orderStr}`,
      },
      raw: { sandbox: this.sandbox, signType: 'RSA2', signContent: content },
      sandboxNotice: this.sandbox
        ? '沙箱模式：未请求支付宝网关，orderStr 为真实 RSA2 签名结果，可直接用于验签演示。'
        : undefined,
    };
  }

  async verifyNotify(input: NotifyInput): Promise<VerifiedNotify> {
    const body = input.body ?? {};
    const signature = String(body.sign ?? '');
    if (!signature) throw BizErrors.paymentSignatureInvalid('支付宝回调缺少 sign');
    const stringifyBody: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      stringifyBody[key] = String(value);
    }
    const content = this.buildContent(stringifyBody);
    if (!this.verify(content, signature)) {
      throw BizErrors.paymentSignatureInvalid('支付宝回调验签失败');
    }
    if (body.app_id && body.app_id !== this.config.pay.alipay.appId) {
      throw BizErrors.paymentSignatureInvalid('回调 app_id 与配置不一致');
    }
    const tradeStatus = String(body.trade_status ?? '');
    const success = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';
    return {
      outTradeNo: String(body.out_trade_no ?? ''),
      providerTradeNo: String(body.trade_no ?? ''),
      amount: Number(formatMoney(body.total_amount ?? 0)),
      status: success ? 'success' : 'failed',
      paidAt: body.gmt_payment ? new Date(String(body.gmt_payment).replace(' ', 'T') + '+08:00') : new Date(),
      rawPayload: body,
    };
  }

  /** 网关调用：统一 POST form 到 gateway（沙箱不发起请求） */
  private async callGateway(method: string, bizContent: Record<string, unknown>): Promise<Record<string, any>> {
    const params: Record<string, string> = {
      app_id: this.config.pay.alipay.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.timestamp(),
      version: '1.0',
      biz_content: JSON.stringify(bizContent),
    };
    params.sign = this.sign(this.buildContent(params));
    const form = new URLSearchParams(params);
    const response = await fetch(this.config.pay.alipay.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: form.toString(),
    });
    const text = await response.text();
    try {
      return JSON.parse(text) as Record<string, any>;
    } catch {
      return { raw: text };
    }
  }

  async queryPayment(outTradeNo: string): Promise<QueryPaymentResult> {
    if (this.sandbox) return { outTradeNo, status: 'unknown', raw: { sandbox: true } };
    const json = await this.callGateway('alipay.trade.query', { out_trade_no: outTradeNo });
    const payload = json.alipay_trade_query_response ?? {};
    const map: Record<string, QueryPaymentResult['status']> = {
      TRADE_SUCCESS: 'success',
      TRADE_FINISHED: 'success',
      WAIT_BUYER_PAY: 'pending',
      TRADE_CLOSED: 'failed',
    };
    return {
      outTradeNo,
      status: payload.trade_status ? map[payload.trade_status] ?? 'unknown' : 'unknown',
      providerTradeNo: payload.trade_no,
      amount: payload.total_amount ? Number(payload.total_amount) : undefined,
      raw: json,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (this.sandbox) {
      return {
        accepted: true,
        providerRefundNo: `sandbox_alipay_refund_${input.refundNo}`,
        raw: { sandbox: true, amount: formatMoney(input.amount), reason: input.reason },
      };
    }
    const json = await this.callGateway('alipay.trade.refund', {
      out_trade_no: input.outTradeNo,
      refund_amount: formatMoney(input.amount),
      refund_reason: input.reason.slice(0, 100),
      out_request_no: input.refundNo,
    });
    const payload = json.alipay_trade_refund_response ?? {};
    const accepted = payload.code === '10000';
    return {
      accepted,
      providerRefundNo: payload.trade_no,
      raw: json,
    };
  }
}
