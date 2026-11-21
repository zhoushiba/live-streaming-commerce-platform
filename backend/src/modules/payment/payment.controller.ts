import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, AuthUser, Public } from '../../common/decorators/auth.decorators';
import { Roles } from '../../common/decorators/auth.decorators';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { PaymentService } from './payment.service';
import { CreatePaymentDto, RefundDto } from './dto/payment.dto';

@ApiTags('支付')
@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly payment: PaymentService) {}

  @Public()
  @Get('providers')
  @ApiOperation({ summary: '支持的支付渠道（含沙箱状态）' })
  providers() {
    return { providers: this.payment.listProviders(), default: 'mock' };
  }

  @ApiBearerAuth()
  @Post('create')
  @HttpCode(200)
  @ApiOperation({ summary: '创建支付（返回渠道支付参数 / Mock 回调报文）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.payment.createPayment(user, dto);
  }

  @ApiBearerAuth()
  @Post('refund/:orderNo')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({ summary: '管理员发起退款（事务：订单退款 + 撤销权益/扣回余额）' })
  refund(@CurrentUser() user: AuthUser, @Param('orderNo') orderNo: string, @Body() dto: RefundDto) {
    return this.payment.refund(user, orderNo, dto.reason);
  }

  @ApiBearerAuth()
  @Get(':outTradeNo')
  @ApiOperation({ summary: '查询支付单（本地流水 + 渠道状态）' })
  query(@CurrentUser() user: AuthUser, @Param('outTradeNo') outTradeNo: string) {
    return this.payment.queryPayment(user, outTradeNo);
  }

  /**
   * Mock 渠道回调（主演示路径）：
   * 把 /payments/create 返回的 mockNotifyBody 原样 POST 两次，第二次应命中幂等，不重复发货。
   */
  @Public()
  @Post('mock/notify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mock 支付异步回调（可重复调用验证幂等）' })
  mockNotify(@Req() req: RawBodyRequest<Request>) {
    return this.payment.handleNotify('mock', {
      headers: req.headers as Record<string, string>,
      body: req.body as Record<string, unknown>,
      rawBody: req.rawBody?.toString('utf8'),
    });
  }

  /**
   * 微信支付 V3 回调：验签（Wechatpay-Signature + 平台证书）+ AES-256-GCM 解密 + 幂等结算。
   * 必须保留原始报文验签，返回微信要求的 {code:'SUCCESS'} 协议体。
   */
  @Public()
  @RawResponse()
  @Post('wechat/notify')
  @HttpCode(200)
  async wechatNotify(@Req() req: RawBodyRequest<Request>, @Res() res: Response): Promise<void> {
    try {
      const outcome = await this.payment.handleNotify('wechat', {
        headers: req.headers as Record<string, string>,
        body: req.body as Record<string, unknown>,
        rawBody: req.rawBody?.toString('utf8'),
      });
      res.status(200).json({ code: 'SUCCESS', message: outcome.duplicate ? '重复通知已忽略' : '成功' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败';
      this.logger.warn(`微信回调处理失败：${message}`);
      res.status(401).json({ code: 'FAIL', message });
    }
  }

  /** 支付宝异步通知：RSA2 验签后返回纯文本 success（支付宝协议要求） */
  @Public()
  @RawResponse()
  @Post('alipay/notify')
  @HttpCode(200)
  async alipayNotify(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      await this.payment.handleNotify('alipay', {
        headers: req.headers as Record<string, string>,
        body: req.body as Record<string, unknown>,
      });
      res.status(200).type('text/plain').send('success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败';
      this.logger.warn(`支付宝回调处理失败：${message}`);
      res.status(200).type('text/plain').send('fail');
    }
  }
}
