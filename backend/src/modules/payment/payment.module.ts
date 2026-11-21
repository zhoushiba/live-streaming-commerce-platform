import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { PaymentController } from './payment.controller';
import { WalletController } from './wallet.controller';
import { PaymentService } from './payment.service';
import { WalletService } from './wallet.service';
import { PaymentKeyService } from './payment-key.service';
import { MockPaymentProvider } from './providers/mock.provider';
import { WechatPayProvider } from './providers/wechat.provider';
import { AlipayProvider } from './providers/alipay.provider';

@Module({
  imports: [OrderModule],
  controllers: [PaymentController, WalletController],
  providers: [
    PaymentService,
    WalletService,
    PaymentKeyService,
    MockPaymentProvider,
    WechatPayProvider,
    AlipayProvider,
  ],
  exports: [PaymentService, WalletService],
})
export class PaymentModule {}
