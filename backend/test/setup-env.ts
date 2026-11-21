/**
 * Jest 全局环境预设（setupFiles，在测试文件加载前执行）。
 *
 * 目的是让 `npm test` 成为一条零外部依赖的命令：
 *  - 数据库用 better-sqlite3 临时文件（每个测试套件自己建，互不干扰）
 *  - 缓存强制走进程内实现，不需要 Redis
 *  - 直播走演示模式，不需要真实推流/CDN
 *  - 不在启动时自动灌种子数据（测试自己在 helper 里显式 seed，便于控制时序）
 */
process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'sqlite';
process.env.DB_AUTO_MIGRATE = 'true';
process.env.DB_LOG_SQL = 'false';
process.env.CACHE_DRIVER = 'memory';
process.env.SEED_ON_BOOT = 'false';
process.env.STREAM_DEMO_MODE = 'true';
process.env.JWT_ISSUER = 'live-commerce-test';
process.env.MOCK_PAY_SECRET = 'test_mock_pay_secret_do_not_use_in_prod';
