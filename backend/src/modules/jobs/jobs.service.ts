import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Knex } from 'knex';
import { KNEX } from '../../database/knex.factory';
import { TABLES } from '../../database/schema';
import { OrderService } from '../order/order.service';
import { PaymentService } from '../payment/payment.service';
import { PaymentProviderCode } from '../payment/dto/payment.dto';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly orders: OrderService,
    private readonly payment: PaymentService,
  ) {}

  /** 每分钟关闭超时未支付订单（走 idx_order_status_expire） */
  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpiredOrders(): Promise<void> {
    try {
      const closed = await this.orders.closeExpiredOrders(200);
      if (closed > 0) this.logger.log(`超时关单 ${closed} 笔`);
    } catch (error) {
      this.logger.error(`超时关单任务失败：${(error as Error).message}`);
    }
  }

  /** 每天 02:30 对账昨日流水 */
  @Cron('30 2 * * *')
  async dailyReconcile(): Promise<void> {
    const billDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const providers: PaymentProviderCode[] = ['mock', 'wechat', 'alipay'];
    for (const provider of providers) {
      try {
        const summary = await this.payment.reconcile(billDate, provider);
        this.logger.log(`对账完成 ${billDate} ${provider}：` + JSON.stringify(summary));
      } catch (error) {
        this.logger.error(`对账失败 ${billDate} ${provider}：${(error as Error).message}`);
      }
    }
  }

  /** 每小时清理 7 天前过期/吊销的 refresh token，避免表膨胀 */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupRefreshTokens(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    try {
      const deleted = await this.knex(TABLES.refreshToken)
        .where('expires_at', '<', cutoff)
        .orWhere('revoked_at', '<', cutoff)
        .del();
      if (deleted > 0) this.logger.log(`清理历史 refresh token ${deleted} 条`);
    } catch (error) {
      this.logger.error(`清理 refresh token 失败：${(error as Error).message}`);
    }
  }
}
