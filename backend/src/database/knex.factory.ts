import knex, { Knex } from 'knex';
import { AppConfig } from '../config/app-config';

export const KNEX = Symbol('KNEX');

/**
 * 依据配置构造 Knex 实例：
 *  - sqlite  → better-sqlite3（本地/测试，零外部依赖）
 *  - mysql   → mysql2 连接池（生产形态，utf8mb4）
 * 两者共用 src/database/schema.ts 的同一套建表逻辑。
 */
export function createKnex(config: AppConfig): Knex {
  if (config.db.client === 'mysql') {
    return knex({
      client: 'mysql2',
      connection: {
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        charset: 'utf8mb4',
        timezone: '+08:00',
        supportBigNumbers: true,
        bigNumberStrings: false,
        dateStrings: true,
      },
      pool: { min: config.db.poolMin, max: config.db.poolMax },
      acquireConnectionTimeout: 10000,
    });
  }

  return knex({
    client: 'better-sqlite3',
    connection: { filename: config.db.filename },
    useNullAsDefault: true,
    // SQLite 写入是串行的，单连接可以彻底避免 SQLITE_BUSY
    pool: { min: 1, max: 1 },
  });
}

/**
 * SQLite 需要显式开启外键约束（MySQL 默认开启）。
 * WAL 模式让读写并发更平滑，适合本地长时间运行的演示。
 */
export async function prepareConnection(db: Knex): Promise<void> {
  if (db.client.config.client !== 'better-sqlite3') return;
  await db.raw('PRAGMA foreign_keys = ON');
  await db.raw('PRAGMA journal_mode = WAL');
  await db.raw('PRAGMA busy_timeout = 5000');
}
