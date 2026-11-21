import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthUser } from '../../common/decorators/auth.decorators';
import { BizError } from '../../common/errors/business.exception';
import { TokenService } from '../auth/token.service';
import { DanmakuService } from './danmaku.service';

interface AuthedSocket extends Socket {
  data: { user?: AuthUser; rooms: Set<number> };
}

/**
 * 实时网关（socket.io，命名空间 /ws）
 * 事件：
 *  - join          { roomId }        → 加入房间，回 ack { code, data: { online } }
 *  - leave         { roomId }
 *  - danmaku:send  { roomId, content, color } → ack { code, message, data }
 *  - ping          { t }             → ack { t, serverTime } 用于前端测延迟
 * 服务端推送：
 *  - danmaku:new / gift:new / presence / live:status / system
 */
@WebSocketGateway({
  namespace: '/ws',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(LiveGateway.name);
  /** roomId -> socketId -> nickname */
  private readonly presence = new Map<number, Map<string, string>>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokenService: TokenService,
    private readonly danmakuService: DanmakuService,
  ) {}

  async handleConnection(socket: AuthedSocket): Promise<void> {
    socket.data.rooms = new Set();
    const raw =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.query?.token as string | undefined) ??
      '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (!token) {
      socket.emit('system', { type: 'anonymous', message: '游客模式：可观看，登录后可发弹幕/送礼' });
      return;
    }
    try {
      const payload = await this.tokenService.verifyAccess(token);
      socket.data.user = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        jti: payload.jti,
      };
      socket.emit('system', { type: 'authed', user: socket.data.user });
    } catch {
      socket.emit('system', { type: 'token_invalid', message: '登录已过期，请重新登录' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: AuthedSocket): void {
    for (const roomId of socket.data.rooms ?? []) {
      this.leaveRoom(socket, roomId, false);
    }
  }

  private leaveRoom(socket: AuthedSocket, roomId: number, leaveSocketRoom = true): void {
    if (leaveSocketRoom) void socket.leave(`room:${roomId}`);
    socket.data.rooms?.delete(roomId);
    const members = this.presence.get(roomId);
    if (!members) return;
    members.delete(socket.id);
    if (members.size === 0) this.presence.delete(roomId);
    this.emitPresence(roomId);
  }

  private emitPresence(roomId: number): void {
    const online = this.presence.get(roomId)?.size ?? 0;
    this.server?.to(`room:${roomId}`).emit('presence', { roomId, online });
  }

  @SubscribeMessage('join')
  async onJoin(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { roomId?: number }) {
    const roomId = Number(body?.roomId);
    if (!Number.isFinite(roomId) || roomId <= 0) {
      return { code: 2001, message: 'roomId 不合法' };
    }
    await socket.join(`room:${roomId}`);
    socket.data.rooms.add(roomId);
    const nickname = socket.data.user?.username ?? '游客';
    if (!this.presence.has(roomId)) this.presence.set(roomId, new Map());
    this.presence.get(roomId)!.set(socket.id, nickname);
    this.emitPresence(roomId);
    const history = await this.danmakuService.history(roomId, 30);
    return { code: 0, data: { roomId, online: this.presence.get(roomId)!.size, history } };
  }

  @SubscribeMessage('leave')
  onLeave(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: { roomId?: number }) {
    const roomId = Number(body?.roomId);
    if (Number.isFinite(roomId)) this.leaveRoom(socket, roomId);
    return { code: 0, data: { roomId } };
  }

  @SubscribeMessage('danmaku:send')
  async onDanmaku(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { roomId?: number; content?: string; color?: string },
  ) {
    const user = socket.data.user;
    if (!user) return { code: 1001, message: '请先登录后再发送弹幕' };
    const roomId = Number(body?.roomId);
    if (!Number.isFinite(roomId)) return { code: 2001, message: 'roomId 不合法' };
    try {
      const result = await this.danmakuService.send(user, roomId, String(body?.content ?? ''), body?.color);
      this.server.to(`room:${roomId}`).emit('danmaku:new', result.danmaku);
      return { code: 0, message: 'ok', data: result };
    } catch (error) {
      if (error instanceof BizError) {
        return { code: error.bizCode, message: error.message };
      }
      this.logger.error(`发送弹幕失败: ${(error as Error).message}`);
      return { code: 9000, message: '服务器开小差了' };
    }
  }

  @SubscribeMessage('ping')
  onPing(@MessageBody() body: { t?: number }) {
    return { code: 0, data: { t: body?.t ?? null, serverTime: Date.now() } };
  }

  /** 礼物广播（gift 模块调用），payload 已由服务端校验 */
  broadcastGift(roomId: number, payload: Record<string, unknown>): void {
    this.server?.to(`room:${roomId}`).emit('gift:new', payload);
  }

  /** 开播/下播状态广播 */
  broadcastLiveStatus(roomId: number, status: string): void {
    this.server?.to(`room:${roomId}`).emit('live:status', { roomId, status, at: new Date().toISOString() });
  }

  onlineCount(roomId: number): number {
    return this.presence.get(roomId)?.size ?? 0;
  }
}
