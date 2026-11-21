import { PayProviderCode } from '../../database/schema';

/** 支付渠道统一抽象：新增渠道只需实现该接口并在工厂注册 */
export interface PaymentProvider {
  readonly code: PayProviderCode;
  /** 展示名，用于前端选择渠道 */
  readonly displayName: string;
  /** 创建支付：返回前端需要的调起参数（微信 JSAPI / 支付宝 orderStr / Mock 通知报文） */
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  /** 回调验签 + 解析，失败抛 BizError(PAYMENT_SIGNATURE_INVALID) */
  verifyNotify(input: NotifyInput): Promise<VerifiedNotify>;
  /** 主动查单（对账、补偿用） */
  queryPayment(outTradeNo: string): Promise<QueryPaymentResult>;
  /** 发起退款 */
  refund(input: RefundInput): Promise<RefundResult>;
}

export interface CreatePaymentInput {
  outTradeNo: string;
  orderNo: string;
  /** 单位：元 */
  amount: number;
  description: string;
  clientIp?: string;
  openId?: string;
}

export interface CreatedPayment {
  provider: PayProviderCode;
  outTradeNo: string;
  amount: number;
  /** 前端调起支付所需参数 */
  payParams: Record<string, unknown>;
  /** 渠道原始响应（脱敏后入库/排查用） */
  raw?: Record<string, unknown>;
  /** Mock 渠道专用：可直接 POST 的回调报文，方便 curl 演示幂等 */
  mockNotifyBody?: Record<string, unknown>;
  /** sandbox 模式说明 */
  sandboxNotice?: string;
}

export interface NotifyInput {
  headers: Record<string, string | undefined>;
  body: Record<string, any>;
  rawBody?: string;
}

export interface VerifiedNotify {
  outTradeNo: string;
  providerTradeNo: string;
  /** 单位：元，用于与订单金额比对 */
  amount: number;
  status: 'success' | 'failed';
  paidAt: Date;
  rawPayload: unknown;
}

export interface QueryPaymentResult {
  outTradeNo: string;
  status: 'pending' | 'success' | 'failed' | 'unknown';
  providerTradeNo?: string;
  amount?: number;
  raw?: unknown;
}

export interface RefundInput {
  outTradeNo: string;
  refundNo: string;
  orderNo: string;
  /** 单位：元 */
  amount: number;
  reason: string;
}

export interface RefundResult {
  accepted: boolean;
  providerRefundNo?: string;
  raw?: unknown;
}

export type PaymentErrorCode = 'SIGNATURE_INVALID' | 'AMOUNT_MISMATCH' | 'NOT_SUPPORTED' | 'NOT_FOUND';
