import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { KNEX } from '../../database/knex.factory';
import { TABLES } from '../../database/schema';
import { BizErrors } from '../../common/errors/business.exception';
import { AuthUser } from '../../common/decorators/auth.decorators';
import { toDate, toIso } from '../../common/utils/time.util';
import { EntitlementService } from '../entitlement/entitlement.service';

export type PlayMode = 'live' | 'demo' | 'offline';

export interface PlaySource {
  id: string;
  protocol: 'hls' | 'flv';
  quality: string;
  url: string;
  isDefault: boolean;
}

export interface PlayInfo {
  roomId: number;
  status: string;
  mode: PlayMode;
  /** 前端按顺序尝试：先 hls（清晰度可切），失败降级 flv，再失败进入 demo 状态机 */
  sources: PlaySource[];
  fallbackOrder: string[];
  retry: { max: number; baseDelay: number; maxDelay: number };
  token: string;
  expiresAt: string;
  locked: boolean;
  lockReason: string | null;
  price: { priceType: string; amount: number } | null;
  poster: string | null;
  /** 演示模式下的说明，前端展示在播放器角标 */
  notice: string;
}

@Injectable()
export class StreamService {
  private readonly logger = new Logger(StreamService.name);

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly entitlementService: EntitlementService,
  ) {}

  /** 播放令牌：HMAC-SHA256 签名，防止盗链（生产由 CDN 鉴权模块校验） */
  private signToken(roomId: number, userId: number | undefined, ttl: number): { token: string; expiresAt: string } {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const payload = Buffer.from(JSON.stringify({ roomId, userId: userId ?? 0, exp })).toString('base64url');
    const sig = createHmac('sha256', this.config.stream.tokenSecret).update(payload).digest('base64url');
    return { token: `${payload}.${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  verifyToken(token: string, roomId: number): boolean {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expected = createHmac('sha256', this.config.stream.tokenSecret).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        roomId: number;
        exp: number;
      };
      return decoded.roomId === roomId && decoded.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  /**
   * 播放信息：
   * - living 且（免费/已购/房主/管理员）→ live，返回 hls 多清晰度 + flv 兜底
   * - 付费未购 → locked，前端渲染购买引导
   * - demoMode 开启或房间未开播 → demo，返回本地演示切片地址，前端走状态机
   */
  async getPlayInfo(roomId: number, user?: AuthUser, quality?: string): Promise<PlayInfo> {
    const room = await this.db(TABLES.liveRoom + ' as r')
      .leftJoin(TABLES.anchor + ' as a', 'a.id', 'r.anchor_id')
      .where('r.id', roomId)
      .select('r.*', 'a.user_id as anchor_user_id')
      .first();
    if (!room) throw BizErrors.notFound('直播间不存在');

    const isOwner = !!user && user.id === room.anchor_user_id;
    const owned = await this.entitlementService.hasAccess(user?.id, 'room', roomId);
    const requiresPurchase = room.price_type !== 'free';
    const canWatch = !requiresPurchase || owned || isOwner || user?.role === 'admin';
    const { token, expiresAt } = this.signToken(roomId, user?.id, this.config.stream.tokenTtl);

    if (!canWatch) {
      return {
        roomId,
        status: room.status,
        mode: 'offline',
        sources: [],
        fallbackOrder: [],
        retry: { max: 0, baseDelay: 1000, maxDelay: 8000 },
        token,
        expiresAt,
        locked: true,
        lockReason: '该直播间为付费直播，购买后即可观看',
        price: { priceType: room.price_type, amount: Number(room.price ?? 0) },
        poster: room.cover_url ?? null,
        notice: '付费内容',
      };
    }

    const qualities = this.config.stream.qualities;
    const activeQuality = quality && qualities.includes(quality) ? quality : qualities[1] ?? qualities[0];
    const isLiving = room.status === 'living';
    const useDemo = this.config.stream.demoMode || !isLiving;

    if (useDemo) {
      const sources: PlaySource[] = [
        {
          id: 'demo-hls',
          protocol: 'hls',
          quality: activeQuality,
          url: `${this.config.stream.hlsBaseUrl}/demo/playlist.m3u8`,
          isDefault: true,
        },
        {
          id: 'demo-flv',
          protocol: 'flv',
          quality: '原画',
          url: `${this.config.stream.flvBaseUrl}/demo/demo.flv`,
          isDefault: false,
        },
      ];
      return {
        roomId,
        status: room.status,
        mode: 'demo',
        sources,
        fallbackOrder: ['demo-hls', 'demo-flv', 'demo-state-machine'],
        retry: { max: 3, baseDelay: 1200, maxDelay: 9000 },
        token,
        expiresAt,
        locked: false,
        lockReason: null,
        price: requiresPurchase ? { priceType: room.price_type, amount: Number(room.price ?? 0) } : null,
        poster: room.cover_url ?? null,
        notice: isLiving
          ? '演示切片：未接入真实推流时由前端状态机模拟直播画面'
          : '主播尚未开播，当前为演示画面',
      };
    }

    const key = room.stream_key as string;
    const sources: PlaySource[] = qualities.map((q, index) => ({
      id: `hls-${q}`,
      protocol: 'hls' as const,
      quality: q,
      url: `${this.config.stream.hlsBaseUrl}/live/${key}/${q}/index.m3u8?token=${encodeURIComponent(token)}`,
      isDefault: q === activeQuality,
    }));
    sources.push({
      id: 'flv-raw',
      protocol: 'flv',
      quality: '原画',
      url: `${this.config.stream.flvBaseUrl}/live/${key}.flv?token=${encodeURIComponent(token)}`,
      isDefault: false,
    });

    return {
      roomId,
      status: room.status,
      mode: 'live',
      sources,
      fallbackOrder: sources.map((s) => s.id),
      retry: { max: 5, baseDelay: 1000, maxDelay: 10000 },
      token,
      expiresAt,
      locked: false,
      lockReason: null,
      price: requiresPurchase ? { priceType: room.price_type, amount: Number(room.price ?? 0) } : null,
      poster: room.cover_url ?? null,
      notice: '直播中',
    };
  }

  /** 推流信息：仅房主/管理员可见；含 RTMP 地址、串流密钥与 OBS 建议参数 */
  async getPushInfo(roomId: number, user: AuthUser) {
    const room = await this.db(TABLES.liveRoom + ' as r')
      .leftJoin(TABLES.anchor + ' as a', 'a.id', 'r.anchor_id')
      .where('r.id', roomId)
      .select('r.*', 'a.user_id as anchor_user_id')
      .first();
    if (!room) throw BizErrors.notFound('直播间不存在');
    if (room.anchor_user_id !== user.id && user.role !== 'admin') {
      throw BizErrors.forbidden('只能查看自己直播间的推流信息');
    }
    const server = this.config.stream.pushBaseUrl.replace(/\/live\/?$/, '').replace(/\/$/, '');
    return {
      roomId,
      status: room.status,
      rtmpUrl: `${server}/live`,
      streamKey: room.stream_key,
      obs: {
        server: `${server}/live`,
        streamKey: room.stream_key,
        encoder: 'x264 / veryfast / 2500kbps / keyint 2s',
        audio: 'aac 128kbps 44.1kHz',
        note: 'SRS 收到 RTMP 后自动转出 HLS/HTTP-FLV，对应播放地址见 play-info',
      },
      hlsPreview: `${this.config.stream.hlsBaseUrl}/live/${room.stream_key}/index.m3u8`,
    };
  }

  /** 直播数据看板（主播/管理端）：在线人数、峰值、时长、码率估算 */
  async getRoomStats(roomId: number, user: AuthUser) {
    const room = await this.db(TABLES.liveRoom + ' as r')
      .leftJoin(TABLES.anchor + ' as a', 'a.id', 'r.anchor_id')
      .where('r.id', roomId)
      .select('r.*', 'a.user_id as anchor_user_id')
      .first();
    if (!room) throw BizErrors.notFound('直播间不存在');
    if (room.anchor_user_id !== user.id && user.role !== 'admin') {
      throw BizErrors.forbidden('无权查看该直播间数据');
    }
    const startsAt = toDate(room.started_at);
    const durationSec = startsAt
      ? Math.max(0, Math.floor(((toDate(room.ended_at) ?? new Date()).getTime() - startsAt.getTime()) / 1000))
      : 0;
    const viewers = Number(room.viewers ?? 0);
    const giftSum = await this.db(TABLES.giftRecord).where({ room_id: roomId }).sum<{ total: number }[]>({ total: 'amount' });
    return {
      roomId,
      status: room.status,
      viewers,
      peakViewers: Number(room.peak_viewers ?? 0),
      likes: Number(room.likes ?? 0),
      durationSec,
      startedAt: toIso(room.started_at),
      estimatedBitrateKbps: this.config.stream.demoMode ? 0 : 2500 + Math.min(viewers, 500) * 2,
      giftIncome: Number(giftSum?.[0]?.total ?? 0),
      demoMode: this.config.stream.demoMode,
    };
  }

  /** 健康检查：给前端播放器做「开播探测」，失败即进入重连 */
  async health(roomId: number) {
    const room = await this.db(TABLES.liveRoom).where({ id: roomId }).first('id', 'status');
    if (!room) throw BizErrors.notFound('直播间不存在');
    return {
      roomId,
      alive: room.status === 'living' || this.config.stream.demoMode,
      mode: this.config.stream.demoMode ? 'demo' : 'live',
      checkedAt: new Date().toISOString(),
    };
  }
}
