import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export const PAYMENT_PROVIDERS = ['mock', 'wechat', 'alipay'] as const;
export type PaymentProviderCode = (typeof PAYMENT_PROVIDERS)[number];

export class CreatePaymentDto {
  @IsString()
  @Length(8, 40, { message: 'orderNo 长度需在 8-40 之间' })
  orderNo!: string;

  @IsIn(PAYMENT_PROVIDERS, { message: 'provider 仅支持 mock / wechat / alipay' })
  provider!: PaymentProviderCode;

  /** 微信 JSAPI 需要用户 openid，沙箱可省略 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  openId?: string;
}

export class RefundDto {
  @IsString()
  @Length(2, 200, { message: '退款原因长度需在 2-200 之间' })
  reason!: string;
}
