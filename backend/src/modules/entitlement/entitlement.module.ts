import { Global, Module } from '@nestjs/common';
import { EntitlementController } from './entitlement.controller';
import { EntitlementService } from './entitlement.service';

/** 权益模块被订单/支付/流媒体三方共用，注册为全局避免循环依赖 */
@Global()
@Module({
  controllers: [EntitlementController],
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}
