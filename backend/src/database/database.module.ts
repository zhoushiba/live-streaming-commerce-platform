import * as fs from 'fs';
import * as path from 'path';
import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Knex } from 'knex';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { createKnex, KNEX, prepareConnection } from './knex.factory';
import { migrate } from './schema';

@Global()
@Module({
  providers: [
    {
      provide: KNEX,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig): Promise<Knex> => {
        const dir = path.dirname(config.db.filename);
        if (config.db.client === 'sqlite' && config.db.filename !== ':memory:' && !fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const db = createKnex(config);
        await prepareConnection(db);
        if (config.db.autoMigrate) {
          await migrate(db);
        }
        return db;
      },
    },
  ],
  exports: [KNEX],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async onApplicationShutdown(): Promise<void> {
    // Knex 3 没有公开的 isDestroyed()，重复 destroy 自身是幂等的，这里只做防御式 try。
    try {
      await this.db.destroy();
    } catch {
      // 忽略：连接池已关闭
    }
  }
}
