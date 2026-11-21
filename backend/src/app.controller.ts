import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { KNEX } from './database/knex.factory';
import { Knex } from 'knex';
import { Public } from './common/decorators/auth.decorators';
import { APP_CONFIG, AppConfig } from './config/app-config';

const startedAt = Date.now();

@ApiTags('系统')
@Controller()
export class AppController {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: '健康检查（进程 + 数据库）' })
  async health(): Promise<Record<string, unknown>> {
    let database = 'up';
    try {
      await this.db.raw('select 1 as ok');
    } catch (error) {
      database = `down: ${(error as Error).message}`;
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'live-streaming-commerce-platform',
      env: this.config.nodeEnv,
      database,
      dbClient: this.config.db.client,
      streamMode: this.config.stream.demoMode ? 'demo' : 'live',
      paymentChannels: ['mock', 'wechat', 'alipay'],
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
