import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { KNEX } from '../../database/knex.factory';
import { TABLES } from '../../database/schema';
import { BizErrors } from '../../common/errors/business.exception';
import { AuthUser } from '../../common/decorators/auth.decorators';
import { CacheService } from '../../infra/cache/cache.service';
import { toIso } from '../../common/utils/time.util';

/** 演示用敏感词库：命中「拒发词」直接拒绝，命中「屏蔽词」替换为 * */
export const BLOCK_WORDS = ['赌博', '博彩', '代开发票', '私彩', '洗钱'];
export const MASK_WORDS = ['傻逼', '煞笔', '妈的', 'fuck', 'shit', '加微信', '加vx'];

export interface DanmakuView {
  id: number;
  roomId: number;
  userId: number | null;
  nickname: string;
  content: string;
  color: string;
  sentAt: string;
}

export interface SendResult {
  danmaku: DanmakuView;
  masked: boolean;
  remaining: number;
}

@Injectable()
export class DanmakuService {
  private readonly logger = new Logger(DanmakuService.name);

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly cache: CacheService,
  ) {}

  /**
   * 内容审核：先做长度校验，再命中拒发词，最后屏蔽词替换为 *。
   * 返回 masked 标记，前端可提示「内容已被安全策略处理」。
   */
  inspect(raw: string): { content: string; masked: boolean } {
    const content = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!content) throw BizErrors.sensitiveWord('弹幕内容不能为空');
    if (content.length > this.config.danmaku.maxLength) {
      throw BizErrors.sensitiveWord(`弹幕不能超过 ${this.config.danmaku.maxLength} 个字符`);
    }
    const lower = content.toLowerCase();
    const blocked = BLOCK_WORDS.find((w) => lower.includes(w.toLowerCase()));
    if (blocked) {
      this.logger.warn(`拦截违规弹幕：命中拒发词「${blocked}」`);
      throw BizErrors.sensitiveWord('内容包含违规词，已被拦截');
    }
    let masked = false;
    let sanitized = content;
    for (const word of MASK_WORDS) {
      if (sanitized.toLowerCase().includes(word.toLowerCase())) {
        masked = true;
        sanitized = sanitized.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '*'.repeat(word.length));
      }
    }
    return { content: sanitized, masked };
  }

  /**
   * 频控：滑动窗口用 Redis/内存计数实现，窗口内超过阈值直接拒绝。
   * 返回剩余可发送次数，前端据此置灰输入框。
   */
  async acquireRateSlot(userId: number): Promise<number> {
    const key = `danmaku:rate:${userId}`;
    const count = await this.cache.incr(key);
    if (count === 1) {
      await this.cache.expire(key, this.config.danmaku.rateWindow);
    }
    const limit = this.config.danmaku.rateLimit;
    if (count > limit) {
      throw BizErrors.rateLimited(`${this.config.danmaku.rateWindow} 秒内最多发送 ${limit} 条弹幕`);
    }
    return Math.max(0, limit - count);
  }

  async send(user: AuthUser, roomId: number, raw: string, color?: string): Promise<SendResult> {
    const room = await this.db(TABLES.liveRoom).where({ id: roomId }).first('id', 'status');
    if (!room) throw BizErrors.notFound('直播间不存在');

    const inspected = this.inspect(raw);
    const remaining = await this.acquireRateSlot(user.id);

    const nickname = await this.resolveNickname(user.id);
    const now = Date.now();
    const [id] = await this.db(TABLES.danmaku).insert({
      room_id: roomId,
      user_id: user.id,
      nickname,
      content: inspected.content,
      color: this.normalizeColor(color),
      status: 'visible',
      sent_at: now,
      created_at: new Date(now),
    });

    return {
      danmaku: {
        id: id as number,
        roomId,
        userId: user.id,
        nickname,
        content: inspected.content,
        color: this.normalizeColor(color),
        sentAt: toIso(now) as string,
      },
      masked: inspected.masked,
      remaining,
    };
  }

  /** 仅允许 #rgb / #rrggbb，避免前端把 color 注入到 style */
  private normalizeColor(color?: string): string {
    return color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : '#ffffff';
  }

  private async resolveNickname(userId: number): Promise<string> {
    const user = await this.db(TABLES.user).where({ id: userId }).first('nickname');
    return user?.nickname ?? '观众';
  }

  async history(roomId: number, limit?: number): Promise<DanmakuView[]> {
    const size = Math.min(limit ?? this.config.danmaku.historySize, 200);
    const rows = await this.db(TABLES.danmaku)
      .where({ room_id: roomId, status: 'visible' })
      .orderBy('id', 'desc')
      .limit(size);
    return rows
      .map((row) => ({
        id: row.id,
        roomId: row.room_id,
        userId: row.user_id ?? null,
        nickname: row.nickname,
        content: row.content,
        color: row.color,
        sentAt: toIso(row.sent_at) ?? toIso(row.created_at) ?? '',
      }))
      .reverse();
  }

  /** 管理端下架违规弹幕 */
  async hide(danmakuId: number, operatorId: number) {
    const row = await this.db(TABLES.danmaku).where({ id: danmakuId }).first();
    if (!row) throw BizErrors.notFound('弹幕不存在');
    await this.db(TABLES.danmaku).where({ id: danmakuId }).update({ status: 'hidden' });
    this.logger.log(`管理员 ${operatorId} 下架弹幕 ${danmakuId}`);
    return { id: danmakuId, status: 'hidden' };
  }
}
