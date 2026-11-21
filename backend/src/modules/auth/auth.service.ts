import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Knex } from 'knex';
import * as bcrypt from 'bcryptjs';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { KNEX } from '../../database/knex.factory';
import { UserRole } from '../../database/schema';
import { BizErrors } from '../../common/errors/business.exception';
import { isUniqueViolation } from '../../common/utils/id.util';
import { toDate, toIso } from '../../common/utils/time.util';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { TokenService } from './token.service';

export interface UserProfile {
  id: number;
  username: string;
  nickname: string;
  role: UserRole;
  avatar: string | null;
  status: string;
  balance: number;
  createdAt: string | null;
  lastLoginAt: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tokenService: TokenService,
  ) {}

  /** 注册：用户行 + 钱包行在同一事务内创建，避免出现「有用户没钱包」的脏数据 */
  async register(dto: RegisterDto, userAgent?: string) {
    const role: UserRole = dto.role === 'anchor' ? 'anchor' : 'viewer';
    const existing = await this.db('user').where({ username: dto.username }).first();
    if (existing) throw BizErrors.forbidden('该用户名已被注册');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    let userId: number;
    try {
      userId = await this.db.transaction(async (trx) => {
        const [id] = await trx('user').insert({
          username: dto.username,
          nickname: dto.nickname ?? dto.username,
          password_hash: passwordHash,
          role,
          status: 'active',
          login_fail_count: 0,
          created_at: new Date(),
          updated_at: new Date(),
        });
        await trx('user_balance').insert({
          user_id: id,
          balance: 0,
          total_recharge: 0,
          total_consume: 0,
          version: 0,
          updated_at: new Date(),
        });
        return id as number;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw BizErrors.forbidden('该用户名已被注册');
      throw error;
    }

    const user = await this.db('user').where({ id: userId }).first();
    const tokens = await this.tokenService.issuePair(
      { id: user.id, username: user.username, role: user.role as UserRole },
      userAgent,
    );
    return { ...tokens, user: await this.getProfile(user.id) };
  }

  /** 登录：失败计数 + 锁定；成功后清零并签发新令牌对 */
  async login(dto: LoginDto, userAgent?: string) {
    const user = await this.db('user').where({ username: dto.username }).first();
    if (!user) throw BizErrors.invalidCredentials();

    if (user.status !== 'active') {
      throw BizErrors.forbidden('账号已被禁用，请联系管理员');
    }

    const lockedUntil = toDate(user.locked_until);
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      const remainMinutes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
      throw BizErrors.accountLocked(remainMinutes);
    }

    const matched = await bcrypt.compare(dto.password, user.password_hash);
    if (!matched) {
      await this.recordLoginFailure(user);
      throw BizErrors.invalidCredentials();
    }

    await this.db('user')
      .where({ id: user.id })
      .update({ login_fail_count: 0, locked_until: null, last_login_at: new Date(), updated_at: new Date() });

    const tokens = await this.tokenService.issuePair(
      { id: user.id, username: user.username, role: user.role as UserRole },
      userAgent,
    );
    return { ...tokens, user: await this.getProfile(user.id) };
  }

  private async recordLoginFailure(user: { id: number; login_fail_count: number }): Promise<void> {
    const nextCount = Number(user.login_fail_count ?? 0) + 1;
    const patch: Record<string, unknown> = { login_fail_count: nextCount, updated_at: new Date() };
    if (nextCount >= this.config.security.loginMaxFail) {
      patch.locked_until = new Date(Date.now() + this.config.security.loginLockMinutes * 60 * 1000);
      patch.login_fail_count = 0;
      this.logger.warn(`用户 ${user.id} 连续登录失败 ${nextCount} 次，已锁定 ${this.config.security.loginLockMinutes} 分钟`);
    }
    await this.db('user').where({ id: user.id }).update(patch);
  }

  /** 刷新：校验 refresh token 签名 + 库内未吊销，执行轮换（旧的立即失效） */
  async refresh(refreshToken: string, userAgent?: string) {
    let payload: { sub: number; jti: string; type: string };
    try {
      payload = await this.tokenService.verifyRefresh(refreshToken);
    } catch (error) {
      if ((error as Error).name === 'TokenExpiredError') throw BizErrors.tokenExpired();
      throw BizErrors.refreshRevoked();
    }
    if (payload.type !== 'refresh') throw BizErrors.refreshRevoked();

    const row = await this.tokenService.findValidRefreshRow(refreshToken);
    if (!row || row.revoked_at) throw BizErrors.refreshRevoked();
    const expiresAt = toDate((row as { expires_at?: unknown }).expires_at);
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw BizErrors.tokenExpired();

    const user = await this.db('user').where({ id: payload.sub }).first();
    if (!user || user.status !== 'active') throw BizErrors.forbidden('账号不可用');

    await this.tokenService.revokeRefreshToken(refreshToken);
    const tokens = await this.tokenService.issuePair(
      { id: user.id, username: user.username, role: user.role as UserRole },
      userAgent,
    );
    return { ...tokens, user: await this.getProfile(user.id) };
  }

  /** 登出：access token 进黑名单（立即失效）+ 吊销 refresh token */
  async logout(accessToken: string | undefined, refreshToken?: string): Promise<{ success: true }> {
    if (accessToken) {
      try {
        const payload = await this.tokenService.verifyAccess(accessToken);
        await this.tokenService.blacklistAccessToken(payload);
      } catch {
        // 令牌本身已过期，无需再拉黑
      }
    }
    if (refreshToken) {
      await this.tokenService.revokeRefreshToken(refreshToken);
    }
    return { success: true };
  }

  async getProfile(userId: number): Promise<UserProfile> {
    const row = await this.db('user as u')
      .leftJoin('user_balance as b', 'b.user_id', 'u.id')
      .where('u.id', userId)
      .select(
        'u.id',
        'u.username',
        'u.nickname',
        'u.role',
        'u.avatar',
        'u.status',
        'u.created_at',
        'u.last_login_at',
        this.db.raw('COALESCE(b.balance, 0) as balance'),
      )
      .first();
    if (!row) throw BizErrors.notFound('用户不存在');
    return {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      role: row.role as UserRole,
      avatar: row.avatar ?? null,
      status: row.status,
      balance: Number(row.balance ?? 0),
      createdAt: toIso(row.created_at),
      lastLoginAt: toIso(row.last_login_at),
    };
  }

  /** 修改昵称 / 头像：只更新传入的字段，返回最新档案 */
  async updateProfile(userId: number, patch: { nickname?: string; avatar?: string }): Promise<UserProfile> {
    const changes: Record<string, unknown> = {};
    if (patch.nickname !== undefined) changes.nickname = patch.nickname.trim();
    if (patch.avatar !== undefined) changes.avatar = patch.avatar.trim() || null;
    if (Object.keys(changes).length > 0) {
      changes.updated_at = new Date();
      await this.db('user').where({ id: userId }).update(changes);
    }
    return this.getProfile(userId);
  }

  async assertUserActive(userId: number): Promise<void> {
    const user = await this.db('user').where({ id: userId }).first();
    if (!user) throw new UnauthorizedException('用户不存在');
    if (user.status !== 'active') throw BizErrors.forbidden('账号已被禁用');
  }
}
