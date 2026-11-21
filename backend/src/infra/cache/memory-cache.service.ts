import { CacheEntry, CacheService } from './cache.service';

/** 进程内缓存：零依赖，适合本地开发与自动化测试 */
export class MemoryCacheService extends CacheService {
  readonly driver = 'memory';

  private readonly store = new Map<string, CacheEntry>();
  private readonly sets = new Map<string, Set<string>>();

  private alive(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expireAt !== null && entry.expireAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.alive(key);
    return entry ? (entry.value as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expireAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
    this.sets.delete(key);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    const entry = this.alive(key);
    const next = (entry ? Number(entry.value) : 0) + 1;
    const expireAt =
      entry?.expireAt ?? (ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null);
    this.store.set(key, { value: next, expireAt });
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.alive(key);
    if (!entry) return;
    entry.expireAt = Date.now() + ttlSeconds * 1000;
  }

  async setAdd(key: string, member: string): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    set.add(member);
    this.sets.set(key, set);
    return 1;
  }

  async setRemove(key: string, member: string): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    return set.delete(member) ? 1 : 0;
  }

  async setMembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async setCard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }

  async flushPrefix(prefix: string): Promise<void> {
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    for (const key of Array.from(this.sets.keys())) {
      if (key.startsWith(prefix)) this.sets.delete(key);
    }
  }
}
