-- ============================================================================
-- 直播 + 点播付费内容平台 · MySQL 基础数据（幂等，可重复执行）
-- ----------------------------------------------------------------------------
-- 用法：
--   1. mysql -u root -p < db/schema.mysql.sql
--   2. mysql -u root -p live_commerce < db/seed.sql
--   3. cd backend && DB_CLIENT=mysql npm run db:seed   # 创建演示账号/直播间/视频
--
-- 为什么分成两步：
--   * 本文件只放「环境无关的字典数据」——分类、礼物、系统配置、演示视频，
--     这些用 SQL 维护最直观，也方便 DBA 在线上补数据。
--   * 账号密码必须由应用层用 bcrypt 计算哈希，因此用户/主播/直播间/钱包
--     统一交给 backend/src/database/seed.ts（`npm run db:seed`）生成。
-- ============================================================================

USE `live_commerce`;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 分类字典
-- ---------------------------------------------------------------------------
INSERT INTO `room_category` (`name`, `icon`, `sort`) VALUES
  ('数码科技', '💻', 10),
  ('服饰穿搭', '👕', 20),
  ('美食探店', '🍜', 30),
  ('美妆护肤', '💄', 40),
  ('知识付费', '📚', 50)
ON DUPLICATE KEY UPDATE `icon` = VALUES(`icon`), `sort` = VALUES(`sort`);

-- ---------------------------------------------------------------------------
-- 礼物字典（礼物消费是钱包余额的第一大出口）
-- ---------------------------------------------------------------------------
INSERT INTO `gift` (`name`, `icon`, `price`, `effect`, `sort`, `enabled`) VALUES
  ('小心心', '💗', 1.00,  'float',   10, 1),
  ('棒棒糖', '🍭', 5.00,  'float',   20, 1),
  ('火箭',   '🚀', 100.00, 'rocket', 30, 1),
  ('皇冠',   '👑', 520.00, 'fullscreen', 40, 1),
  ('嘉年华', '🎡', 2000.00, 'fullscreen', 50, 1)
ON DUPLICATE KEY UPDATE
  `icon` = VALUES(`icon`), `price` = VALUES(`price`),
  `effect` = VALUES(`effect`), `sort` = VALUES(`sort`), `enabled` = VALUES(`enabled`);

-- ---------------------------------------------------------------------------
-- 系统配置
-- ---------------------------------------------------------------------------
INSERT INTO `sys_config` (`cfg_key`, `cfg_value`, `remark`) VALUES
  ('order.ttl_minutes', '15', '订单未支付自动关闭时长（分钟）'),
  ('danmaku.max_length', '60', '单条弹幕最大字符数'),
  ('danmaku.rate_limit', '5', '限流窗口内最大条数'),
  ('danmaku.rate_window', '5', '限流窗口（秒）'),
  ('reconciliation.enabled', 'true', '是否开启每日支付对账')
ON DUPLICATE KEY UPDATE `cfg_value` = VALUES(`cfg_value`), `remark` = VALUES(`remark`);

-- ---------------------------------------------------------------------------
-- 演示点播内容（付费内容，剧集 level 定价；免费判定：video.price <= 0 或 episode.free = 1）
-- ---------------------------------------------------------------------------
INSERT INTO `video` (`id`, `title`, `cover_url`, `description`, `price`, `category_id`, `status`)
VALUES
  (1, '从零实现一个 Node.js 直播流媒体服务', '/media/demo/cover-1.svg',
      'HLS/FLV 协议、切片、鉴权播放地址的完整实现拆解。', 19.90,
      (SELECT `id` FROM `room_category` WHERE `name` = '知识付费'), 'published'),
  (2, 'MySQL 索引与事务实战：订单/支付/钱包', '/media/demo/cover-2.svg',
      '组合索引设计、执行计划、行锁与幂等落地的实战复盘。', 29.90,
      (SELECT `id` FROM `room_category` WHERE `name` = '知识付费'), 'published'),
  (3, 'Vue3 + TypeScript 播放器工程化', '/media/demo/cover-3.svg',
      'hls.js / flv.js 双引擎、自动降级、清晰度切换与断流重连。', 9.90,
      (SELECT `id` FROM `room_category` WHERE `name` = '数码科技'), 'published')
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`), `price` = VALUES(`price`);

INSERT INTO `video_episode` (`id`, `video_id`, `episode_no`, `title`, `play_url`, `duration`, `free`)
VALUES
  (1, 1, 1, '第 1 集：直播协议全景', '/media/demo/playlist.m3u8', 600, 1),
  (2, 1, 2, '第 2 集：FFmpeg 切片与多码率', '/media/demo/playlist.m3u8', 720, 0),
  (3, 1, 3, '第 3 集：拉流鉴权与防盗链', '/media/demo/demo.flv', 540, 0),
  (4, 2, 1, '第 1 集：B+ 树与组合索引', '/media/demo/playlist.m3u8', 900, 1),
  (5, 2, 2, '第 2 集：事务隔离与行锁', '/media/demo/playlist.m3u8', 840, 0),
  (6, 3, 1, '第 1 集：双引擎播放器架构', '/media/demo/playlist.m3u8', 480, 1),
  (7, 3, 2, '第 2 集：断流重连与清晰度切换', '/media/demo/demo.flv', 600, 0)
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`), `play_url` = VALUES(`play_url`);
