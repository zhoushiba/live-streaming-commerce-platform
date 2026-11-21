import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig } from './app-config';

/**
 * 全局配置模块：把 .env + 默认值收敛成一个强类型对象，
 * 各模块通过 @Inject(APP_CONFIG) 注入，避免到处 process.env。
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadAppConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
