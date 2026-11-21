import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [OrderModule, PaymentModule],
  providers: [JobsService],
})
export class JobsModule {}
