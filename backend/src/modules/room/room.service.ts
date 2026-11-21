import { Inject, Injectable, Logger } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../../database/knex.factory';
import { RoomStatus, TABLES, TargetType } from '../../database/schema';
import { BizErrors } from '../../common/errors/business.exception';
import { buildPage } from '../../common/dto/pagination.dto';
import { AuthUser } from '../../common/decorators/auth.decorators';
import { toIso } from '../../common/utils/time.util';
import { EntitlementService } from '../entitlement/entitlement.service';
import { CreateRoomDto, ListRoomsQuery, UpdateRoomDto } from './dto/room.dto';
import { randomBytes } from 'node:crypto';

const PRICE_TYPE_DAYS: Record<string, number | null> = { free: null, monthly: 31, yearly: 366 };

export interface RoomCard {
  id: number;
  title: string;
  coverUrl: string | null;
  status: RoomStatus;
  priceType: string;
  price: number;
  viewers: number;
  likes: number;
  startedAt: string | null;
  anchor: { id: number; displayName: string; userId: number };
  category: { id: number; name: string } | null;
}

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly entitlementService: EntitlementService,
  ) {}

  async listCategories() {
    return this.db(TABLES.roomCategory).orderBy('sort', 'asc');
  }

  /** 首页房间列表：一次 join 拿齐主播/分类，避免 N+1 */
  async listRooms(query: ListRoomsQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const base = this.db(TABLES.liveRoom + ' as r')
      .leftJoin(TABLES.anchor + ' as a', 'a.id', 'r.anchor_id')
      .leftJoin(TABLES.roomCategory + ' as c', 'c.id', 'r.category_id')
      .modify((qb) => {
        if (query.categoryId) qb.where('r.category_id', query.categoryId);
        if (query.status) qb.where('r.status', query.status);
        if (query.keyword) qb.where('r.title', 'like', `%${query.keyword}%`);
      });

    const countRow = await base.clone().count<{ total: number }[]>({ total: '*' }).first();
    const total = Number(countRow?.total ?? 0);

    const rows = await base
      .clone()
      .select(
        'r.id',
        'r.title',
        'r.cover_url',
        'r.status',
        'r.price_type',
        'r.price',
        'r.viewers',
        'r.likes',
        'r.started_at',
        'r.created_at',
        'a.id as anchor_id',
        'a.user_id as anchor_user_id',
        'a.display_name as anchor_name',
        'c.id as category_id',
        'c.name as category_name',
      )
      .modify((qb) => {
        switch (query.sort) {
          case 'new':
            qb.orderBy('r.created_at', 'desc');
            break;
          case 'price_asc':
            qb.orderBy('r.price', 'asc');
            break;
          case 'price_desc':
            qb.orderBy('r.price', 'desc');
            break;
          default:
            qb.orderBy('r.viewers', 'desc').orderBy('r.id', 'desc');
        }
      })
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return buildPage(rows.map((row: Record<string, any>) => this.toRoomCard(row)), total, page, pageSize);
  }

  private toRoomCard(row: Record<string, any>): RoomCard {
    return {
      id: row.id,
      title: row.title,
      coverUrl: row.cover_url ?? null,
      status: row.status as RoomStatus,
      priceType: row.price_type,
      price: Number(row.price ?? 0),
      viewers: Number(row.viewers ?? 0),
      likes: Number(row.likes ?? 0),
      startedAt: toIso(row.started_at),
      anchor: { id: row.anchor_id, displayName: row.anchor_name, userId: row.anchor_user_id },
      category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
    };
  }

  /** 房间详情：附带当前用户的观看权限，前端据此渲染「立即购买」或播放器 */
  async getRoomDetail(roomId: number, user?: AuthUser) {
    const row = await this.db(TABLES.liveRoom + ' as r')
      .leftJoin(TABLES.anchor + ' as a', 'a.id', 'r.anchor_id')
      .leftJoin(TABLES.roomCategory + ' as c', 'c.id', 'r.category_id')
      .where('r.id', roomId)
      .select(
        'r.*',
        'a.display_name as anchor_name',
        'a.user_id as anchor_user_id',
        'a.introduce as anchor_introduce',
        'a.follower_count as anchor_followers',
        'c.name as category_name',
      )
      .first();
    if (!row) throw BizErrors.notFound('直播间不存在');

    const targetType: TargetType = 'room';
    const owned = await this.entitlementService.hasAccess(user?.id, targetType, roomId);
    const isOwner = user ? user.id === row.anchor_user_id : false;
    const requiresPurchase = row.price_type !== 'free';
    const canWatch = !requiresPurchase || owned || isOwner || user?.role === 'admin';

    return {
      id: row.id,
      title: row.title,
      coverUrl: row.cover_url,
      status: row.status as RoomStatus,
      priceType: row.price_type,
      price: Number(row.price ?? 0),
      viewers: Number(row.viewers ?? 0),
      peakViewers: Number(row.peak_viewers ?? 0),
      likes: Number(row.likes ?? 0),
      streamKey: isOwner || user?.role === 'admin' ? row.stream_key : undefined,
      startedAt: toIso(row.started_at),
      endedAt: toIso(row.ended_at),
      anchor: {
        id: row.anchor_id,
        userId: row.anchor_user_id,
        displayName: row.anchor_name,
        introduce: row.anchor_introduce,
        followers: Number(row.anchor_followers ?? 0),
      },
      category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
      access: {
        requiresPurchase,
        owned,
        canWatch,
        isOwner,
      },
    };
  }

  /** 主播入驻：首次创建直播间时自动补 anchor 档案（幂等） */
  private async ensureAnchorProfile(userId: number): Promise<{ id: number; display_name: string }> {
    const existing = await this.db(TABLES.anchor).where({ user_id: userId }).first();
    if (existing) return existing;
    const user = await this.db(TABLES.user).where({ id: userId }).first();
    if (!user) throw BizErrors.notFound('用户不存在');
    const [id] = await this.db(TABLES.anchor).insert({
      user_id: userId,
      display_name: user.nickname,
      introduce: '这个人很懒，还没有填写简介',
      follower_count: 0,
      verified: false,
      created_at: new Date(),
    });
    this.logger.log(`自动创建主播档案 user=${userId} anchor=${id}`);
    return { id: id as number, display_name: user.nickname };
  }

  async createRoom(user: AuthUser, dto: CreateRoomDto) {
    const anchor = await this.ensureAnchorProfile(user.id);
    const priceType = dto.priceType ?? 'free';
    if (priceType === 'free' && Number(dto.price ?? 0) > 0) {
      throw BizErrors.forbidden('免费房间不能设置价格');
    }
    if (priceType !== 'free' && !(Number(dto.price) > 0)) {
      throw BizErrors.forbidden('付费房间必须设置大于 0 的价格');
    }
    if (dto.categoryId) {
      const category = await this.db(TABLES.roomCategory).where({ id: dto.categoryId }).first();
      if (!category) throw BizErrors.notFound('分类不存在');
    }
    const streamKey = `live_${anchor.id}_${randomBytes(8).toString('hex')}`;
    const [id] = await this.db(TABLES.liveRoom).insert({
      anchor_id: anchor.id,
      category_id: dto.categoryId ?? null,
      title: dto.title,
      cover_url: dto.coverUrl ?? null,
      status: 'idle',
      price_type: priceType,
      price: priceType === 'free' ? 0 : dto.price,
      viewers: 0,
      peak_viewers: 0,
      likes: 0,
      stream_key: streamKey,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return this.getRoomDetail(id as number, user);
  }

  private async findRoomOwnedBy(roomId: number, userId: number) {
    const row = await this.db(TABLES.liveRoom + ' as r')
      .leftJoin(TABLES.anchor + ' as a', 'a.id', 'r.anchor_id')
      .where('r.id', roomId)
      .select('r.*', 'a.user_id as anchor_user_id')
      .first();
    if (!row) throw BizErrors.notFound('直播间不存在');
    if (row.anchor_user_id !== userId) throw BizErrors.forbidden('只能操作自己的直播间');
    return row;
  }

  async updateRoom(user: AuthUser, roomId: number, dto: UpdateRoomDto) {
    const room = await this.findRoomOwnedBy(roomId, user.id);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.coverUrl !== undefined) patch.cover_url = dto.coverUrl;
    if (dto.categoryId !== undefined) patch.category_id = dto.categoryId;
    if (dto.priceType !== undefined) patch.price_type = dto.priceType;
    if (dto.price !== undefined) patch.price = dto.price;
    if (room.status === 'living' && dto.priceType !== undefined) {
      throw BizErrors.roomInvalidState('直播中不能修改计费方式，请下播后再改');
    }
    await this.db(TABLES.liveRoom).where({ id: roomId }).update(patch);
    return this.getRoomDetail(roomId, user);
  }

  /** 开播：idle/ended -> living，记录开播时间 */
  async startLive(user: AuthUser, roomId: number) {
    const room = await this.findRoomOwnedBy(roomId, user.id);
    if (room.status === 'living') throw BizErrors.roomInvalidState('直播间已经在直播中');
    await this.db(TABLES.liveRoom).where({ id: roomId }).update({
      status: 'living',
      started_at: new Date(),
      ended_at: null,
      viewers: 0,
      peak_viewers: 0,
      updated_at: new Date(),
    });
    return this.getRoomDetail(roomId, user);
  }

  async endLive(user: AuthUser, roomId: number) {
    const room = await this.findRoomOwnedBy(roomId, user.id);
    if (room.status !== 'living') throw BizErrors.roomInvalidState('当前没有在直播');
    await this.db(TABLES.liveRoom).where({ id: roomId }).update({
      status: 'ended',
      ended_at: new Date(),
      updated_at: new Date(),
    });
    return this.getRoomDetail(roomId, user);
  }

  async likeRoom(roomId: number) {
    const room = await this.db(TABLES.liveRoom).where({ id: roomId }).first();
    if (!room) throw BizErrors.notFound('直播间不存在');
    await this.db(TABLES.liveRoom).where({ id: roomId }).increment('likes', 1);
    const updated = await this.db(TABLES.liveRoom).where({ id: roomId }).first('likes');
    return { likes: Number(updated?.likes ?? 0) };
  }

  /** 主播中心：我的直播间 */
  async listMyRooms(user: AuthUser) {
    const anchor = await this.db(TABLES.anchor).where({ user_id: user.id }).first();
    if (!anchor) return [];
    const rows = await this.db(TABLES.liveRoom + ' as r')
      .leftJoin(TABLES.roomCategory + ' as c', 'c.id', 'r.category_id')
      .leftJoin(TABLES.anchor + ' as a', 'a.id', 'r.anchor_id')
      .where('r.anchor_id', anchor.id)
      .select('r.*', 'c.name as category_name', 'a.display_name as anchor_name', 'a.user_id as anchor_user_id')
      .orderBy('r.id', 'desc');
    return rows.map((row) => this.toRoomCard(row));
  }

  /** 进入房间：累加观看人数 + 写观看历史（幂等 upsert） */
  async enterRoom(roomId: number, user?: AuthUser) {
    const room = await this.db(TABLES.liveRoom).where({ id: roomId }).first();
    if (!room) throw BizErrors.notFound('直播间不存在');
    if (room.status === 'living') {
      await this.db(TABLES.liveRoom).where({ id: roomId }).increment({ viewers: 1 });
      await this.db(TABLES.liveRoom)
        .where({ id: roomId })
        .whereRaw('viewers > peak_viewers')
        .update({ peak_viewers: this.db.ref('viewers') });
    }
    if (user) {
      const existing = await this.db(TABLES.viewHistory).where({ user_id: user.id, room_id: roomId }).first();
      if (existing) {
        await this.db(TABLES.viewHistory)
          .where({ id: existing.id })
          .update({ watched_seconds: Number(existing.watched_seconds ?? 0) + 1, updated_at: new Date() });
      } else {
        await this.db(TABLES.viewHistory).insert({
          user_id: user.id,
          room_id: roomId,
          watched_seconds: 1,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }
    const fresh = await this.db(TABLES.liveRoom).where({ id: roomId }).first();
    return { roomId, viewers: Number(fresh?.viewers ?? 0), status: fresh?.status as RoomStatus };
  }

  /** 直播间价格对应的权益天数（供订单模块复用） */
  getEntitlementDays(priceType: string): number | null {
    return PRICE_TYPE_DAYS[priceType] ?? null;
  }
}
