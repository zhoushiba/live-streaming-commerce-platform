import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ValidationPipe } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './infra/cache/cache.module';
import { AuthModule } from './modules/auth/auth.module';
import { EntitlementModule } from './modules/entitlement/entitlement.module';
import { RoomModule } from './modules/room/room.module';
import { StreamModule } from './modules/stream/stream.module';
import { DanmakuModule } from './modules/danmaku/danmaku.module';
import { GiftModule } from './modules/gift/gift.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
import { VideoModule } from './modules/video/video.module';
import { AdminModule } from './modules/admin/admin.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AppController } from './app.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AppConfigModule,
    DatabaseModule,
    CacheModule,
    AuthModule,
    EntitlementModule,
    RoomModule,
    StreamModule,
    DanmakuModule,
    GiftModule,
    OrderModule,
    PaymentModule,
    VideoModule,
    AdminModule,
    JobsModule,
  ],
  controllers: [AppController],
  providers: [
    // 顺序敏感：先认证再鉴权
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        stopAtFirstError: true,
      }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
