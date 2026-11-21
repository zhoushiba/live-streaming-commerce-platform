import { Inject, Injectable, Logger } from '@nestjs/common';
import { createDecipheriv, createSign, createVerify, randomBytes } from 'node:crypto';
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
 * 微信支付 V3（JSAPI）：
 * - 请求签名：RSA-SHA256(商户私钥) + Authorization: WECHATPAY2-SHA256-RSA2048
 * - 回调验签：RSA-SHA256(微信支付平台证书公钥) 校验 Wechatpay-Signature
 * - 回调解密：AEAD_AES_256_GCM，key = APIv3 密钥，aad = associated_data
 * sandbox 模式下不发起网络请求，但签名/验签/解密全部走真实实现，便于本地演示与单测。
 */
@Injectable()
export class WechatPayProvider implements PaymentProvider {
  readonly code = 'wechat' as const;
  readonly displayName = '微信支付（V3 JSAPI）';
  private readonly logger = new Logger(WechatPayProvider.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly keys: PaymentKeyService,
  ) {}

  private get sandbox(): boolean {
    return this.config.pay.wechat.mode !== 'live';
  }

  private signRsa(message: string, which: 'merchant' | 'platform' = 'merchant'): string {
    const key = which === 'merchant' ? this.keys.wechatMerchant().privateKey : this.keys.wechatPlatform().privateKey;
    const signer = createSign('RSA-SHA256');
    signer.update(message, 'utf8');
    signer.end();
    return signer.sign(key, 'base64');
  }

  private verifyRsa(message: string, signature: string): boolean {
    try {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(message, 'utf8');
      verifier.end();
      return verifier.verify(this.keys.wechatPlatform().publicKey, signature, 'base64');
    } catch (error) {
      this.logger.warn(`微信回调验签异常：${(error as Error).message}`);
      return false;
    }
  }

  private authorization(method: string, urlPath: string, body: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = this.signRsa(message);
    return (
      `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.pay.wechat.mchId}",` +
      `nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",` +
      `serial_no="${this.config.pay.wechat.serialNo || 'SANDBOX_SERIAL'}"`
    );
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const urlPath = '/v3/pay/transactions/jsapi';
    const payload = {
      appid: this.config.pay.wechat.appId,
      mchid: this.config.pay.wechat.mchId,
      description: input.description.slice(0, 120),
      out_trade_no: input.outTradeNo,
      notify_url: this.config.pay.wechat.notifyUrl,
      amount: { total: Math.round(input.amount * 100), currency: 'CNY' },
      payer: { openid: input.openId ?? 'sandbox_openid' },
      attach: JSON.stringify({ orderNo: input.orderNo }),
    };
    const body = JSON.stringify(payload);
    const authorization = this.authorization('POST', urlPath, body);

    let prepayId = `sandbox_prepay_${input.outTradeNo}`;
    let raw: Record<string, unknown> = { sandbox: true, request: { method: 'POST', url: urlPath, body: payload } };

    if (!this.sandbox) {
      const response = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authorization,
          'User-Agent': 'live-commerce-platform/1.0',
        },
        body,
      });
      const text = await response.text();
      if (!response.ok) {
        this.logger.error(`微信下单失败 HTTP ${response.status}: ${text}`);
        throw BizErrors.paymentChannelError(`微信下单失败：HTTP ${response.status}`);
      }
      const json = JSON.parse(text) as { prepay_id?: string };
      if (!json.prepay_id) throw BizErrors.paymentChannelError('微信下单返回缺少 prepay_id');
      prepayId = json.prepay_id;
      raw = { sandbox: false, prepayId };
    }

    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = randomBytes(16).toString('hex');
    const pkg = `prepay_id=${prepayId}`;
    const paySign = this.signRsa(`${this.config.pay.wechat.appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`);

    return {
      provider: 'wechat',
      outTradeNo: input.outTradeNo,
      amount: input.amount,
      payParams: {
        appId: this.config.pay.wechat.appId,
        timeStamp,
        nonceStr,
        package: pkg,
        signType: 'RSA',
        paySign,
      },
      raw,
      sandboxNotice: this.sandbox
        ? '沙箱模式：未请求微信服务器，prepay_id 为本地模拟值；签名与回调验签为真实 RSA-SHA256 实现。'
        : undefined,
    };
  }

  /** AEAD_AES_256_GCM 解密线上回调 resource */
  decryptResource(resource: { ciphertext: string; nonce: string; associated_data?: string }): string {
    const key = this.keys.apiV3Key();
    const data = Buffer.from(resource.ciphertext, 'base64');
    const iv = Buffer.from(resource.nonce, 'utf8');
    const authTag = data.subarray(data.length - 16);
    const encrypted = data.subarray(0, data.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return plain;
  }

  async verifyNotify(input: NotifyInput): Promise<VerifiedNotify> {
    const headers = input.headers ?? {};
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const signature = headers['wechatpay-signature'];
    const rawBody = input.rawBody ?? JSON.stringify(input.body ?? {});
    if (!timestamp || !nonce || !signature) {
      throw BizErrors.paymentSignatureInvalid('缺少微信支付签名头');
    }
    const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(skew) || skew > 300) {
      throw BizErrors.paymentSignatureInvalid('回调时间戳超出 5 分钟窗口');
    }
    if (!this.verifyRsa(`${timestamp}\n${nonce}\n${rawBody}\n`, signature)) {
      throw BizErrors.paymentSignatureInvalid('微信支付回调验签失败');
    }

    const body = input.body ?? {};
    const resource = body.resource;
    if (!resource?.ciphertext) throw BizErrors.paymentSignatureInvalid('回调缺少 resource 密文');
    const plain = this.decryptResource(resource);
    const decrypted = JSON.parse(plain) as {
      out_trade_no: string;
      transaction_id: string;
      trade_state: string;
      amount: { total: number; currency: string };
      success_time?: string;
    };
    const paidAt = decrypted.success_time ? new Date(decrypted.success_time) : new Date();

    return {
      outTradeNo: decrypted.out_trade_no,
      providerTradeNo: decrypted.transaction_id,
      amount: Number(formatMoney(decrypted.amount.total / 100)),
      status: decrypted.trade_state === 'SUCCESS' ? 'success' : 'failed',
      paidAt,
      rawPayload: { notification: body, decrypted },
    };
  }

  async queryPayment(outTradeNo: string): Promise<QueryPaymentResult> {
    if (this.sandbox) return { outTradeNo, status: 'unknown', raw: { sandbox: true } };
    const urlPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${this.config.pay.wechat.mchId}`;
    const authorization = this.authorization('GET', urlPath, '');
    const response = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, {
      headers: { Authorization: authorization, Accept: 'application/json' },
    });
    const json = (await response.json()) as {
      trade_state?: string;
      transaction_id?: string;
      amount?: { total: number };
    };
    const map: Record<string, QueryPaymentResult['status']> = {
      SUCCESS: 'success',
      NOTPAY: 'pending',
      CLOSED: 'failed',
      PAYERROR: 'failed',
      REFUND: 'success',
    };
    return {
      outTradeNo,
      status: json.trade_state ? map[json.trade_state] ?? 'unknown' : 'unknown',
      providerTradeNo: json.transaction_id,
      amount: json.amount ? json.amount.total / 100 : undefined,
      raw: json,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (this.sandbox) {
      return {
        accepted: true,
        providerRefundNo: `sandbox_refund_${input.refundNo}`,
        raw: { sandbox: true, amount: formatMoney(input.amount), reason: input.reason },
      };
    }
    const urlPath = '/v3/refund/domestic/refunds';
    const body = JSON.stringify({
      out_trade_no: input.outTradeNo,
      out_refund_no: input.refundNo,
      reason: input.reason.slice(0, 80),
      notify_url: `${this.config.pay.wechat.notifyUrl.replace(/\/notify$/, '/refund-notify')}`,
      amount: { refund: Math.round(input.amount * 100), total: Math.round(input.amount * 100), currency: 'CNY' },
    });
    const authorization = this.authorization('POST', urlPath, body);
    const response = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      this.logger.error(`微信退款失败 HTTP ${response.status}: ${text}`);
      return { accepted: false, raw: { status: response.status, body: text } };
    }
    const json = JSON.parse(text) as { refund_id?: string };
    return { accepted: true, providerRefundNo: json.refund_id, raw: json };
  }
}
