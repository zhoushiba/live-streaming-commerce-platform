import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Knex } from 'knex';

import { AppModule } from '../../src/app.module';
import { APP_CONFIG, AppConfig, loadAppConfig } from '../../src/config/app-config';
import { createKnex, KNEX, prepareConnection } from '../../src/database/knex.factory';
import { migrate } from '../../src/database/schema';
import { seedDatabase } from '../../src/database/seed';
import { RequestIdMiddleware } from '../../src/common/middleware/request-id.middleware';

/** 统一响应信封：ResponseInterceptor 包装后的形状 */
export interface ApiEnvelope<T = any> {
  code: number;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface LoginResult extends TokenPair {
  user: {
    id: number;
    username: string;
    nickname: string;
    role: 'viewer' | 'anchor' | 'admin';
    balance: number;
  };
}

export const ACCOUNTS = {
  admin: { username: 'admin', password: 'Admin@123456' },
  anchor: { username: 'anchor', password: 'Anchor@123456' },
  viewer: { username: 'viewer', password: 'Viewer@123456' },
  viewer2: { username: 'viewer2', password: 'Viewer2@123456' },
} as const;

/**
 * 每个测试套件独立的一套运行环境：
 * 临时目录下的 sqlite 文件 + 内存缓存 + demo 直播模式。
 * 通过覆盖 APP_CONFIG / KNEX 两个 provider，把真实的 AppModule 完整装配起来（E2E 而非 mock）。
 */
export class TestContext {
  private constructor(
    readonly app: INestApplication,
    readonly db: Knex,
    readonly config: AppConfig,
    private readonly workspace: string,
  ) {}

  static async create(label: string): Promise<TestContext> {
    const startedAt = Date.now();
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `lsc-${label}-`));
    const base = loadAppConfig();
    const config: AppConfig = {
      ...base,
      nodeEnv: 'test',
      isProd: false,
      apiPrefix: 'api',
      db: { ...base.db, client: 'sqlite', filename: path.join(workspace, `${label}.db`), autoMigrate: true, logSql: false },
      cache: { ...base.cache, driver: 'memory' },
      stream: { ...base.stream, demoMode: true },
      seed: { ...base.seed, seedOnBoot: false },
    };

    const db = createKnex(config);
    await prepareConnection(db);
    await migrate(db);
    await seedDatabase(db, config);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(KNEX)
      .useValue(db)
      .compile();

    const app = moduleRef.createNestApplication({ rawBody: true });
    // 与 main.ts 保持一致的全局装配（前缀 / 请求 ID），否则测的是另一套行为
    app.setGlobalPrefix(config.apiPrefix);
    const requestIdMiddleware = new RequestIdMiddleware();
    app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
    await app.init();
    if (process.env.LSC_TEST_TIMING) {
      console.log(`[test-timing] ${label} 启动装配 ${Date.now() - startedAt}ms`);
    }

    return new TestContext(app, db, config, workspace);
  }

  /** 原始 supertest 句柄：request(app.getHttpServer()) */
  get server(): any {
    return this.app.getHttpServer();
  }

  request(): any {
    return request(this.server);
  }

  url(p: string): string {
    return `/${this.config.apiPrefix}${p}`;
  }

  async login(username: string, password: string): Promise<LoginResult> {
    const res = await this.request().post(this.url('/auth/login')).send({ username, password });
    const body = res.body as ApiEnvelope<LoginResult>;
    if (body?.code !== 0) throw new Error(`登录失败 ${username}: ${JSON.stringify(body)}`);
    return body.data;
  }

  async token(who: keyof typeof ACCOUNTS): Promise<string> {
    const account = ACCOUNTS[who];
    const result = await this.login(account.username, account.password);
    return result.accessToken;
  }

  /** 便捷断言：返回 code===0 的 data，失败时打印完整响应体 */
  static unwrap<T = any>(res: { body: any; status: number }, expectStatus?: number): T {
    if (expectStatus !== undefined && res.status !== expectStatus) {
      throw new Error(`期望 HTTP ${expectStatus}，实际 ${res.status}：${JSON.stringify(res.body)}`);
    }
    const body = res.body as ApiEnvelope<T>;
    if (body?.code !== 0) throw new Error(`期望业务码 0，实际 ${JSON.stringify(body)}`);
    return body.data;
  }

  async close(): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.app.close();
    } finally {
      fs.rmSync(this.workspace, { recursive: true, force: true });
      if (process.env.LSC_TEST_TIMING) {
        console.log(`[test-timing] 关闭耗时 ${Date.now() - startedAt}ms`);
      }
    }
  }
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
