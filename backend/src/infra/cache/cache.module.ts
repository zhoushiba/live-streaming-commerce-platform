import { Global, Inject, Logger, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { CacheService } from './cache.service';
import { MemoryCacheService } from './memory-cache.service';
import { RedisCacheService } from './redis-cache.service';

/**
 * 缓存模块：CACHE_DRIVER=redis 时连接真实 Redis，
 * 连接失败自动降级到内存实现并打警告，保证本地零依赖可跑。
 */
@Global()
@Module({
  providers: [
    {
      provide: CacheService,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig): Promise<CacheService> => {
        const logger = new Logger('CacheModule');
        if (config.cache.driver !== 'redis') {
          logger.log('缓存驱动：memory（进程内实现）');
          return new MemoryCacheService();
        }
        try {
          const { default: Redis } = await import('ioredis');
          const client = new Redis({
            host: config.cache.redis.host,
            port: config.cache.redis.port,
            password: config.cache.redis.password,
            db: config.cache.redis.db,
            keyPrefix: config.cache.keyPrefix,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 3000,
          });
          await client.connect();
          await client.ping();
          logger.log(`缓存驱动：redis ${config.cache.redis.host}:${config.cache.redis.port}`);
          return new RedisCacheService(client);
        } catch (error) {
          logger.warn(
            `Redis 连接失败（${(error as Error).message}），已降级为内存缓存。` +
              '生产环境请检查 REDIS_HOST/REDIS_PORT 或启动 docker-compose 中的 redis 服务。',
          );
          return new MemoryCacheService();
        }
      },
    },
  ],
  exports: [CacheService],
})
export class CacheModule {}
