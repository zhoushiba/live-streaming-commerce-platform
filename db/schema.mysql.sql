-- ============================================================================
-- 直播 + 点播付费内容平台 · MySQL 8.0 DDL
-- ----------------------------------------------------------------------------
-- 说明：
--   1. 本文件是生产环境（DB_CLIENT=mysql）的建表脚本，与 backend/src/database/schema.ts
--      保持同构；本地 SQLite 由 Knex 自动建表，无需手工执行。
--   2. 所有表 InnoDB + utf8mb4 + utf8mb4_unicode_ci，金额统一 DECIMAL(12,2)，
--      主键 BIGINT UNSIGNED AUTO_INCREMENT，时间 DATETIME。
--   3. 索引不是装饰：每条组合索引都对应一个真实查询，理由见 docs/database.md。
--   4. 执行顺序即外键依赖顺序：先父表后子表。
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `live_commerce`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `live_commerce`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- 1. 用户
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`        VARCHAR(32)  NOT NULL COMMENT '登录名，唯一',
  `nickname`        VARCHAR(32)  NOT NULL,
  `password_hash`   VARCHAR(100) NOT NULL COMMENT 'bcrypt(cost=10)',
  `role`            VARCHAR(16)  NOT NULL DEFAULT 'viewer' COMMENT 'viewer/anchor/admin',
  `avatar`          VARCHAR(255) NULL,
  `status`          VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active/disabled',
  `login_fail_count` INT         NOT NULL DEFAULT 0,
  `locked_until`    DATETIME     NULL,
  `last_login_at`   DATETIME     NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_username` (`username`),
  KEY `idx_user_role` (`role`),
  KEY `idx_user_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户';

-- ---------------------------------------------------------------------------
-- 2. 钱包（余额变动一律走 UPDATE ... WHERE balance >= ?，禁止读-改-写）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_balance` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `balance`         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_recharge`  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_consume`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `version`         INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_balance_user` (`user_id`),
  CONSTRAINT `fk_balance_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_balance_non_negative` CHECK (`balance` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='钱包余额';

-- ---------------------------------------------------------------------------
-- 3. 余额流水（biz_no 唯一：同一业务单号只能记一次账）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `balance_transaction` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `biz_type`      VARCHAR(16) NOT NULL COMMENT 'recharge/consume/refund',
  `amount`        DECIMAL(12,2) NOT NULL COMMENT '带符号：充值为正，消费为负',
  `balance_after` DECIMAL(12,2) NOT NULL,
  `biz_no`        VARCHAR(64) NOT NULL COMMENT '幂等键：recharge:<orderNo> / gift:<requestId> / refund:<refundNo>',
  `remark`        VARCHAR(255) NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bt_biz_no` (`biz_no`),
  KEY `idx_bt_user_time` (`user_id`, `created_at`),
  KEY `idx_bt_type` (`biz_type`),
  CONSTRAINT `fk_bt_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='钱包流水';

-- ---------------------------------------------------------------------------
-- 4. Refresh Token（只存 sha256 摘要，支持轮换 + 吊销）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `refresh_token` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `token_hash`  CHAR(64) NOT NULL COMMENT 'sha256(refresh token)',
  `jti`         VARCHAR(64) NOT NULL,
  `expires_at`  DATETIME NOT NULL,
  `revoked_at`  DATETIME NULL,
  `ip`          VARCHAR(64) NULL,
  `user_agent`  VARCHAR(255) NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rt_hash` (`token_hash`),
  KEY `idx_rt_user_revoked` (`user_id`, `revoked_at`),
  KEY `idx_rt_expire` (`expires_at`),
  CONSTRAINT `fk_rt_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='刷新令牌';

-- ---------------------------------------------------------------------------
-- 5. 主播资料
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `anchor` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `display_name`   VARCHAR(32) NOT NULL,
  `introduce`      VARCHAR(255) NULL,
  `follower_count` INT NOT NULL DEFAULT 0,
  `verified`       TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_anchor_user` (`user_id`),
  CONSTRAINT `fk_anchor_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='主播';

-- ---------------------------------------------------------------------------
-- 6. 分类
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `room_category` (
  `id`   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(32) NOT NULL,
  `icon` VARCHAR(64) NULL,
  `sort` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_category_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='直播/点播分类';

-- ---------------------------------------------------------------------------
-- 7. 直播间
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `live_room` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `anchor_id`    BIGINT UNSIGNED NOT NULL,
  `category_id`  BIGINT UNSIGNED NULL,
  `title`        VARCHAR(100) NOT NULL,
  `cover_url`    VARCHAR(255) NULL,
  `status`       VARCHAR(16) NOT NULL DEFAULT 'idle' COMMENT 'idle/living/ended',
  `price_type`   VARCHAR(16) NOT NULL DEFAULT 'free' COMMENT 'free/monthly/yearly',
  `price`        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `viewers`      INT NOT NULL DEFAULT 0,
  `peak_viewers` INT NOT NULL DEFAULT 0,
  `likes`        INT NOT NULL DEFAULT 0,
  `stream_key`   VARCHAR(64) NOT NULL COMMENT '推流密钥，唯一',
  `started_at`   DATETIME NULL,
  `ended_at`     DATETIME NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_room_stream_key` (`stream_key`),
  -- 首页：WHERE status='living' AND category_id=? ORDER BY viewers DESC
  KEY `idx_room_status_category` (`status`, `category_id`, `viewers`),
  -- 主播中心：WHERE anchor_id=? AND status=?
  KEY `idx_room_anchor_status` (`anchor_id`, `status`),
  CONSTRAINT `fk_room_anchor` FOREIGN KEY (`anchor_id`) REFERENCES `anchor` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_room_category` FOREIGN KEY (`category_id`) REFERENCES `room_category` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='直播间';

-- ---------------------------------------------------------------------------
-- 8. 点播视频
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `video` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`       VARCHAR(100) NOT NULL,
  `cover_url`   VARCHAR(255) NULL,
  `description` TEXT NULL,
  `price`       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `category_id` BIGINT UNSIGNED NULL,
  `status`      VARCHAR(16) NOT NULL DEFAULT 'published',
  `play_count`  INT NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_video_status_created` (`status`, `created_at`),
  CONSTRAINT `fk_video_category` FOREIGN KEY (`category_id`) REFERENCES `room_category` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='点播视频';

-- ---------------------------------------------------------------------------
-- 9. 剧集（购买粒度是「集」）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `video_episode` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `video_id`   BIGINT UNSIGNED NOT NULL,
  `episode_no` INT NOT NULL,
  `title`      VARCHAR(100) NOT NULL,
  `play_url`   VARCHAR(255) NOT NULL,
  `duration`   INT NOT NULL DEFAULT 0 COMMENT '秒',
  `free`       TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_episode_no` (`video_id`, `episode_no`),
  CONSTRAINT `fk_episode_video` FOREIGN KEY (`video_id`) REFERENCES `video` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='点播剧集';

-- ---------------------------------------------------------------------------
-- 10. 权益（同一用户 + 同一内容唯一，重复购买走续期）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `purchase_entitlement` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `target_type` VARCHAR(16) NOT NULL COMMENT 'room/video',
  `target_id`   BIGINT UNSIGNED NOT NULL,
  `source`      VARCHAR(16) NOT NULL DEFAULT 'order',
  `order_id`    BIGINT UNSIGNED NULL,
  `start_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expire_at`   DATETIME NULL COMMENT 'NULL = 永久',
  `status`      VARCHAR(16) NOT NULL DEFAULT 'active',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_entitlement_target` (`user_id`, `target_type`, `target_id`),
  KEY `idx_entitlement_order` (`order_id`),
  KEY `idx_entitlement_expire` (`expire_at`),
  CONSTRAINT `fk_entitlement_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内容权益';

-- ---------------------------------------------------------------------------
-- 11. 弹幕（room_id + id 覆盖「取最近 N 条」）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `danmaku` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_id`    BIGINT UNSIGNED NOT NULL,
  `user_id`    BIGINT UNSIGNED NULL,
  `nickname`   VARCHAR(32) NOT NULL,
  `content`    VARCHAR(120) NOT NULL,
  `color`      VARCHAR(16) NOT NULL DEFAULT '#ffffff',
  `status`     VARCHAR(16) NOT NULL DEFAULT 'visible' COMMENT 'visible/hidden',
  `sent_at`    BIGINT NOT NULL COMMENT '毫秒时间戳',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_danmaku_room_id` (`room_id`, `id`),
  CONSTRAINT `fk_danmaku_room` FOREIGN KEY (`room_id`) REFERENCES `live_room` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='弹幕';

-- ---------------------------------------------------------------------------
-- 12. 礼物字典
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `gift` (
  `id`      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`    VARCHAR(32) NOT NULL,
  `icon`    VARCHAR(64) NOT NULL,
  `price`   DECIMAL(12,2) NOT NULL,
  `effect`  VARCHAR(32) NOT NULL DEFAULT 'none',
  `sort`    INT NOT NULL DEFAULT 0,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gift_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='礼物';

-- ---------------------------------------------------------------------------
-- 13. 礼物记录（request_id 唯一 = 客户端重试幂等）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `gift_record` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_id`    BIGINT UNSIGNED NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `gift_id`    BIGINT UNSIGNED NOT NULL,
  `count`      INT NOT NULL DEFAULT 1,
  `amount`     DECIMAL(12,2) NOT NULL,
  `request_id` VARCHAR(64) NOT NULL COMMENT '客户端幂等 ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gift_request` (`request_id`),
  KEY `idx_gift_record_room` (`room_id`, `created_at`),
  KEY `idx_gift_record_user` (`user_id`, `created_at`),
  KEY `idx_gift_record_gift` (`gift_id`, `created_at`),
  CONSTRAINT `fk_gift_record_room` FOREIGN KEY (`room_id`) REFERENCES `live_room` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gift_record_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gift_record_gift` FOREIGN KEY (`gift_id`) REFERENCES `gift` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='礼物消费记录';

-- ---------------------------------------------------------------------------
-- 14. 观看历史
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `view_history` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `room_id`         BIGINT UNSIGNED NOT NULL,
  `watched_seconds` INT NOT NULL DEFAULT 0,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_view_history` (`user_id`, `room_id`),
  KEY `idx_view_room_time` (`room_id`, `updated_at`),
  CONSTRAINT `fk_view_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_view_room` FOREIGN KEY (`room_id`) REFERENCES `live_room` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='观看历史';

-- ---------------------------------------------------------------------------
-- 15. 订单（order 是保留字，故表名 orders）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `orders` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no`        VARCHAR(40) NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `biz_type`        VARCHAR(16) NOT NULL COMMENT 'room/video/recharge',
  `target_id`       BIGINT UNSIGNED NULL,
  `amount`          DECIMAL(12,2) NOT NULL,
  `status`          VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/paid/closed/refunded',
  `idempotency_key` VARCHAR(64) NOT NULL COMMENT '客户端幂等键',
  `expire_at`       DATETIME NOT NULL,
  `paid_at`         DATETIME NULL,
  `closed_at`       DATETIME NULL,
  `remark`          VARCHAR(255) NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  UNIQUE KEY `uk_order_idempotency` (`idempotency_key`),
  -- 我的订单：WHERE user_id=? AND status=? ORDER BY created_at DESC
  KEY `idx_order_user_status` (`user_id`, `status`, `created_at`),
  -- 超时关单：WHERE status='pending' AND expire_at < NOW()
  KEY `idx_order_status_expire` (`status`, `expire_at`),
  CONSTRAINT `fk_order_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单';

-- ---------------------------------------------------------------------------
-- 16. 订单明细
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `order_item` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`   BIGINT UNSIGNED NOT NULL,
  `title`      VARCHAR(100) NOT NULL,
  `item_type`  VARCHAR(16) NOT NULL,
  `item_id`    BIGINT UNSIGNED NULL,
  `price`      DECIMAL(12,2) NOT NULL,
  `quantity`   INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_order_item_order` (`order_id`),
  CONSTRAINT `fk_order_item_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单明细';

-- ---------------------------------------------------------------------------
-- 17. 支付流水（out_trade_no 唯一 = 回调幂等的数据库兜底）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payment_transaction` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `out_trade_no`      VARCHAR(40) NOT NULL COMMENT '商户侧单号，唯一',
  `order_no`          VARCHAR(40) NOT NULL,
  `provider`          VARCHAR(16) NOT NULL COMMENT 'mock/wechat/alipay',
  `trade_type`        VARCHAR(16) NOT NULL DEFAULT 'JSAPI',
  `amount`            DECIMAL(12,2) NOT NULL,
  `status`            VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/success/failed/refunded',
  `provider_trade_no` VARCHAR(64) NULL COMMENT '渠道交易号',
  `notify_payload`    TEXT NULL COMMENT '回调原始报文，便于对账留痕',
  `paid_at`           DATETIME NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pay_out_trade_no` (`out_trade_no`),
  UNIQUE KEY `uk_pay_provider_trade_no` (`provider_trade_no`),
  KEY `idx_pay_order_no` (`order_no`),
  -- 对账：WHERE provider=? AND status='success' AND paid_at BETWEEN ?
  KEY `idx_pay_provider_status` (`provider`, `status`, `paid_at`),
  CONSTRAINT `fk_pay_order` FOREIGN KEY (`order_no`) REFERENCES `orders` (`order_no`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付流水';

-- ---------------------------------------------------------------------------
-- 18. 退款单
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `refund_record` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `refund_no`          VARCHAR(40) NOT NULL,
  `order_no`           VARCHAR(40) NOT NULL,
  `payment_tx_id`      BIGINT UNSIGNED NOT NULL,
  `amount`             DECIMAL(12,2) NOT NULL,
  `reason`             VARCHAR(255) NOT NULL,
  `status`             VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected/success',
  `operator_id`        BIGINT UNSIGNED NULL,
  `provider_refund_no` VARCHAR(64) NULL,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_refund_no` (`refund_no`),
  KEY `idx_refund_order` (`order_no`),
  KEY `idx_refund_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='退款单';

-- ---------------------------------------------------------------------------
-- 19. 对账日志（bill_date + provider 唯一，重复执行只更新）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reconciliation_log` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bill_date`     CHAR(10) NOT NULL COMMENT 'yyyy-MM-dd',
  `provider`      VARCHAR(16) NOT NULL,
  `total_local`   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_channel` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `local_count`   INT NOT NULL DEFAULT 0,
  `channel_count` INT NOT NULL DEFAULT 0,
  `diff_count`    INT NOT NULL DEFAULT 0,
  `detail_json`   TEXT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_recon_date_provider` (`bill_date`, `provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付对账';

-- ---------------------------------------------------------------------------
-- 20. 系统配置
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sys_config` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cfg_key`    VARCHAR(64) NOT NULL,
  `cfg_value`  TEXT NOT NULL,
  `remark`     VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_config_key` (`cfg_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置';

SET FOREIGN_KEY_CHECKS = 1;
