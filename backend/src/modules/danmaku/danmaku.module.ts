import { Global, Module } from '@nestjs/common';
import { DanmakuController } from './danmaku.controller';
import { DanmakuService } from './danmaku.service';
import { LiveGateway } from './live.gateway';

/** 弹幕 + 实时网关：网关需被 gift/stream 复用，故全局注册 */
@Global()
@Module({
  controllers: [DanmakuController],
  providers: [DanmakuService, LiveGateway],
  exports: [DanmakuService, LiveGateway],
})
export class DanmakuModule {}
