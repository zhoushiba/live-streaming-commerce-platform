import * as path from 'path';
import { PROJECT_ROOT, loadEnvFiles } from './env-file';

export type DbClient = 'sqlite' | 'mysql';
export type CacheDriver = 'memory' | 'redis';
export type PayMode = 'sandbox' | 'live';

export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  apiPrefix: string;
  publicWebUrl: string;
  corsOrigins: string[];
  projectRoot: string;
  db: {
    client: DbClient;
    filename: string;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    poolMin: number;
    poolMax: number;
    autoMigrate: boolean;
    logSql: boolean;
  };
  jwt: {
    accessSecret: string;
    accessTtl: number;
    refreshSecret: string;
    refreshTtl: number;
    issuer: string;
  };
  security: {
    loginMaxFail: number;
    loginLockMinutes: number;
  };
  cache: {
    driver: CacheDriver;
    keyPrefix: string;
    redis: { host: string; port: number; password?: string; db: number };
  };
  stream: {
    dir: string;
    tokenSecret: string;
    tokenTtl: number;
    allowPreviewPaidRoom: boolean;
    /** 播放域名（本地默认由后端 /media 静态目录托管，生产替换为 CDN 域名） */
    hlsBaseUrl: string;
    flvBaseUrl: string;
    /** 推流地址（SRS / nginx-rtmp 的 RTMP 入口） */
    pushBaseUrl: string;
    /** 无真实推流时的演示模式：播放器走 demo 状态机 */
    demoMode: boolean;
    qualities: string[];
  };
  danmaku: {
    rateLimit: number;
    rateWindow: number;
    maxLength: number;
    historySize: number;
  };
  pay: {
    mock: { secret: string; ttlMinutes: number };
    wechat: {
      mode: PayMode;
      appId: string;
      mchId: string;
      serialNo: string;
      apiV3Key: string;
      privateKeyPath: string;
      platformCertPath: string;
      notifyUrl: string;
    };
    alipay: {
      mode: PayMode;
      appId: string;
      gateway: string;
      privateKeyPath: string;
      publicKeyPath: string;
      notifyUrl: string;
    };
  };
  jobs: {
    orderCloseCron: string;
    viewerFlushCron: string;
    reconciliationCron: string;
  };
  seed: {
    /** 启动时自动灌入演示数据（幂等），生产建议关闭 */
    seedOnBoot: boolean;
    adminUsername: string;
    adminPassword: string;
    anchorUsername: string;
    anchorPassword: string;
    viewerUsername: string;
    viewerPassword: string;
  };
}

function str(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function int(key: string, fallback: number): number {
  const value = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const value = (process.env[key] ?? '').toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

/** 相对路径统一以仓库根目录为基准解析，保证从 backend/ 目录启动也指向同一份 storage */
export function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

let cached: AppConfig | null = null;

export function loadAppConfig(): AppConfig {
  if (cached) return cached;
  // 仓库根 .env 优先，其次 backend/.env；真实环境变量优先级最高
  loadEnvFiles([path.resolve(PROJECT_ROOT, '.env'), path.resolve(PROJECT_ROOT, 'backend/.env')]);

  const nodeEnv = str('NODE_ENV', 'development');
  cached = {
    nodeEnv,
    isProd: nodeEnv === 'production',
    port: int('PORT', 3000),
    apiPrefix: str('API_PREFIX', 'api'),
    publicWebUrl: str('PUBLIC_WEB_URL', 'http://localhost:5173'),
    corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    projectRoot: PROJECT_ROOT,
    db: {
      client: str('DB_CLIENT', 'sqlite') === 'mysql' ? 'mysql' : 'sqlite',
      filename: resolvePath(str('DB_FILENAME', './storage/live.db')),
      host: str('DB_HOST', '127.0.0.1'),
      port: int('DB_PORT', 3306),
      user: str('DB_USER', 'live_app'),
      password: str('DB_PASSWORD', 'live_app_pwd'),
      database: str('DB_NAME', 'live_commerce'),
      poolMin: int('DB_POOL_MIN', 2),
      poolMax: int('DB_POOL_MAX', 10),
      autoMigrate: bool('DB_AUTO_MIGRATE', true),
      logSql: bool('DB_LOG_SQL', false),
    },
    jwt: {
      accessSecret: str('JWT_ACCESS_SECRET', 'dev_access_secret_please_change_me_32bytes'),
      accessTtl: int('JWT_ACCESS_TTL', 900),
      refreshSecret: str('JWT_REFRESH_SECRET', 'dev_refresh_secret_please_change_me_32bytes'),
      refreshTtl: int('JWT_REFRESH_TTL', 604800),
      issuer: str('JWT_ISSUER', 'live-commerce'),
    },
    security: {
      loginMaxFail: int('LOGIN_MAX_FAIL', 5),
      loginLockMinutes: int('LOGIN_LOCK_MINUTES', 15),
    },
    cache: {
      driver: str('CACHE_DRIVER', 'memory') === 'redis' ? 'redis' : 'memory',
      keyPrefix: str('REDIS_KEY_PREFIX', 'live:'),
      redis: {
        host: str('REDIS_HOST', '127.0.0.1'),
        port: int('REDIS_PORT', 6379),
        password: str('REDIS_PASSWORD') || undefined,
        db: int('REDIS_DB', 0),
      },
    },
    stream: {
      dir: resolvePath(str('STREAM_DIR', './storage/streams')),
      tokenSecret: str('STREAM_TOKEN_SECRET', 'dev_stream_secret_please_change_me_32b'),
      tokenTtl: int('STREAM_TOKEN_TTL', 7200),
      allowPreviewPaidRoom: bool('ALLOW_PREVIEW_PAID_ROOM', false),
      hlsBaseUrl: str('STREAM_HLS_BASE_URL', 'http://localhost:3000/media'),
      flvBaseUrl: str('STREAM_FLV_BASE_URL', 'http://localhost:3000/media'),
      pushBaseUrl: str('STREAM_PUSH_BASE_URL', 'rtmp://localhost:1935/live'),
      demoMode: bool('STREAM_DEMO_MODE', true),
      qualities: str('STREAM_QUALITIES', '1080p,720p,480p')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    danmaku: {
      rateLimit: int('DANMAKU_RATE_LIMIT', 5),
      rateWindow: int('DANMAKU_RATE_WINDOW', 5),
      maxLength: int('DANMAKU_MAX_LENGTH', 60),
      historySize: int('DANMAKU_HISTORY_SIZE', 50),
    },
    pay: {
      mock: {
        secret: str('MOCK_PAY_SECRET', 'dev_mock_pay_secret_change_me'),
        ttlMinutes: int('MOCK_PAY_TTL_MINUTES', 15),
      },
      wechat: {
        mode: str('WECHAT_PAY_MODE', 'sandbox') === 'live' ? 'live' : 'sandbox',
        appId: str('WECHAT_APPID', 'wx_demo_appid'),
        mchId: str('WECHAT_MCHID', '1900000000'),
        serialNo: str('WECHAT_SERIAL_NO'),
        apiV3Key: str('WECHAT_API_V3_KEY'),
        privateKeyPath: resolvePath(str('WECHAT_PRIVATE_KEY_PATH', './storage/sandbox/wechat_apiclient_key.pem')),
        platformCertPath: resolvePath(
          str('WECHAT_PLATFORM_CERT_PATH', './storage/sandbox/wechat_platform_cert.pem'),
        ),
        notifyUrl: str('WECHAT_NOTIFY_URL', 'http://localhost:3000/api/payments/wechat/notify'),
      },
      alipay: {
        mode: str('ALIPAY_MODE', 'sandbox') === 'live' ? 'live' : 'sandbox',
        appId: str('ALIPAY_APP_ID', '2021000000000000'),
        gateway: str('ALIPAY_GATEWAY', 'https://openapi.alipay.com/gateway.do'),
        privateKeyPath: resolvePath(str('ALIPAY_PRIVATE_KEY_PATH', './storage/sandbox/alipay_app_private.pem')),
        publicKeyPath: resolvePath(
          str('ALIPAY_PUBLIC_KEY_PATH', './storage/sandbox/alipay_platform_public.pem'),
        ),
        notifyUrl: str('ALIPAY_NOTIFY_URL', 'http://localhost:3000/api/payments/alipay/notify'),
      },
    },
    jobs: {
      orderCloseCron: str('ORDER_CLOSE_CRON', '*/60 * * * * *'),
      viewerFlushCron: str('VIEWER_FLUSH_CRON', '*/30 * * * * *'),
      reconciliationCron: str('RECONCILIATION_CRON', '0 30 2 * * *'),
    },
    seed: {
      seedOnBoot: bool('SEED_ON_BOOT', nodeEnv !== 'production'),
      adminUsername: str('SEED_ADMIN_USERNAME', 'admin'),
      adminPassword: str('SEED_ADMIN_PASSWORD', 'Admin@123456'),
      anchorUsername: str('SEED_ANCHOR_USERNAME', 'anchor'),
      anchorPassword: str('SEED_ANCHOR_PASSWORD', 'Anchor@123456'),
      viewerUsername: str('SEED_VIEWER_USERNAME', 'viewer'),
      viewerPassword: str('SEED_VIEWER_PASSWORD', 'Viewer@123456'),
    },
  };
  return cached;
}

/** 仅供测试：修改环境变量后重新加载 */
export function resetAppConfigCache(): void {
  cached = null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
