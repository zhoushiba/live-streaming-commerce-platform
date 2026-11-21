import type Redis from 'ioredis';
import { CacheService } from './cache.service';

/** Redis 实现：语义与 MemoryCacheService 完全一致，可随时切换 */
export class RedisCacheService extends CacheService {
  readonly driver = 'redis';

  constructor(private readonly client: Redis) {
    super();
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, payload, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, payload);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const value = await this.client.incr(key);
    if (value === 1 && ttlSeconds && ttlSeconds > 0) {
      await this.client.expire(key, ttlSeconds);
    }
    return value;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  async setAdd(key: string, member: string): Promise<number> {
    return this.client.sadd(key, member);
  }

  async setRemove(key: string, member: string): Promise<number> {
    return this.client.srem(key, member);
  }

  async setMembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async setCard(key: string): Promise<number> {
    return this.client.scard(key);
  }

  async flushPrefix(prefix: string): Promise<void> {
    // 生产禁用 KEYS，这里用 SCAN 渐进式删除
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length) await this.client.del(...keys);
    } while (cursor !== '0');
  }
}
