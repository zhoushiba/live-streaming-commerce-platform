import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../../database/knex.factory';
import { TABLES } from '../../database/schema';
import { AuthUser } from '../../common/decorators/auth.decorators';
import { BizErrors } from '../../common/errors/business.exception';
import { buildPage, PageResult } from '../../common/dto/pagination.dto';
import { round2 } from '../../common/utils/money.util';
import { EntitlementService } from '../entitlement/entitlement.service';

export interface ListVideosQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  categoryId?: number;
}

@Injectable()
export class VideoService {
  constructor(
    @Inject(KNEX) private readonly knex: Knex,
    private readonly entitlement: EntitlementService,
  ) {}

  async list(query: ListVideosQuery): Promise<PageResult<Record<string, unknown>>> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 12));
    const base = this.knex(TABLES.video).where('status', 'published');
    if (query.keyword) base.andWhere('title', 'like', `%${query.keyword}%`);
    if (query.categoryId) base.andWhere({ category_id: query.categoryId });

    const [{ total }] = await base.clone().count<{ total: number }[]>({ total: '*' });
    const rows = await base
      .clone()
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const videoIds = rows.map((row) => Number(row.id));
    const episodeCounts = videoIds.length
      ? await this.knex(TABLES.videoEpisode)
          .whereIn('video_id', videoIds)
          .groupBy('video_id')
          .select('video_id')
          .count<{ video_id: number; count: number }[]>({ count: '*' })
      : [];
    const countMap = new Map(episodeCounts.map((row) => [Number(row.video_id), Number(row.count)]));

    return buildPage(
      rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        coverUrl: row.cover_url,
        description: row.description,
        price: round2(row.price),
        free: Number(row.price) <= 0,
        categoryId: row.category_id,
        playCount: row.play_count,
        episodeCount: countMap.get(Number(row.id)) ?? 0,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      Number(total),
      page,
      pageSize,
    );
  }

  async detail(videoId: number, user?: AuthUser): Promise<Record<string, unknown>> {
    const video = await this.knex(TABLES.video).where({ id: videoId, status: 'published' }).first();
    if (!video) throw BizErrors.notFound('视频不存在');
    const episodes = await this.knex(TABLES.videoEpisode).where({ video_id: videoId }).orderBy('episode_no', 'asc');
    const isFree = Number(video.price) <= 0;

    const episodeList = [];
    for (const episode of episodes) {
      const owned =
        Boolean(episode.free) ||
        isFree ||
        (user ? await this.entitlement.hasAccess(user.id, 'video', Number(episode.id)) : false);
      episodeList.push({
        id: Number(episode.id),
        episodeNo: episode.episode_no,
        title: episode.title,
        duration: episode.duration,
        free: Boolean(episode.free),
        locked: !owned,
        price: round2(video.price),
        /** 未解锁不下发播放地址，避免前端直接抓包 */
        playUrl: owned ? episode.play_url : null,
      });
    }

    return {
      id: Number(video.id),
      title: video.title,
      coverUrl: video.cover_url,
      description: video.description,
      price: round2(video.price),
      free: isFree,
      playCount: video.play_count,
      episodes: episodeList,
      ownedAll: episodeList.every((item) => !item.locked),
    };
  }

  /** 获取某一集的播放地址：免费 / 已购才下发，否则返回 locked + 价格 */
  async playEpisode(videoId: number, episodeId: number, user: AuthUser): Promise<Record<string, unknown>> {
    const episode = await this.knex(TABLES.videoEpisode).where({ id: episodeId, video_id: videoId }).first();
    if (!episode) throw BizErrors.notFound('剧集不存在');
    const video = await this.knex(TABLES.video).where({ id: videoId }).first();
    if (!video) throw BizErrors.notFound('视频不存在');
    const owned =
      Boolean(episode.free) || Number(video.price) <= 0 || (await this.entitlement.hasAccess(user.id, 'video', episodeId));
    if (!owned) {
      return {
        locked: true,
        reason: '该剧集需购买后观看',
        price: round2(video.price),
        videoId,
        episodeId,
        purchaseHint: '调用 POST /api/orders（bizType=video, targetId=剧集ID）下单支付后即可解锁',
      };
    }
    await this.knex(TABLES.video).where({ id: videoId }).increment('play_count', 1);
    return {
      locked: false,
      videoId,
      episodeId,
      title: episode.title,
      playUrl: episode.play_url,
      duration: episode.duration,
      /** 点播同样支持 HLS/FLV，前端播放器复用直播组件 */
      protocol: String(episode.play_url).includes('.flv') ? 'flv' : 'hls',
    };
  }
}
