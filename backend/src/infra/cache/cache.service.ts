/**
 * 缓存抽象层。
 * 生产可用 Redis（ioredis），本地无 Redis 时自动降级为进程内实现，
 * 两者遵守同一套语义，业务代码只依赖这个抽象类。
 */
export abstract class CacheService {
  abstract readonly driver: string;

  abstract get<T>(key: string): Promise<T | null>;
  abstract set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  /** 自增计数，首次写入时设置过期时间（用于限流、观看人数） */
  abstract incr(key: string, ttlSeconds?: number): Promise<number>;
  abstract expire(key: string, ttlSeconds: number): Promise<void>;
  abstract setAdd(key: string, member: string): Promise<number>;
  abstract setRemove(key: string, member: string): Promise<number>;
  abstract setMembers(key: string): Promise<string[]>;
  abstract setCard(key: string): Promise<number>;
  abstract flushPrefix(prefix: string): Promise<void>;
}

export interface CacheEntry {
  value: unknown;
  expireAt: number | null;
}
