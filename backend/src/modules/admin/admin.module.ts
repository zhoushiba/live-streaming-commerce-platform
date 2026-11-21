import { Module } from '@nestjs/common';
import { DanmakuModule } from '../danmaku/danmaku.module';
import { PaymentModule } from '../payment/payment.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [DanmakuModule, PaymentModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
