import * as crypto from 'crypto';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Knex } from 'knex';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { KNEX } from '../../database/knex.factory';
import { UserRole } from '../../database/schema';
import { CacheService } from '../../infra/cache/cache.service';

export interface AccessTokenPayload {
  sub: number;
  username: string;
  role: UserRole;
  type: 'access';
  jti: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: number;
  type: 'refresh';
  jti: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/** 刷新令牌只存哈希，数据库泄露也无法直接冒用 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * 令牌服务：
 *  - Access Token：15 分钟，无状态，登出时写入黑名单（按 jti）
 *  - Refresh Token：7 天，落库（哈希），刷新时轮换（旧的立即吊销）
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(KNEX) private readonly db: Knex,
    private readonly cache: CacheService,
  ) {}

  async issuePair(
    user: { id: number; username: string; role: UserRole },
    userAgent?: string,
  ): Promise<TokenPair> {
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, role: user.role, type: 'access', jti: accessJti },
      {
        secret: this.config.jwt.accessSecret,
        issuer: this.config.jwt.issuer,
        expiresIn: this.config.jwt.accessTtl,
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh', jti: refreshJti },
      {
        secret: this.config.jwt.refreshSecret,
        issuer: this.config.jwt.issuer,
        expiresIn: this.config.jwt.refreshTtl,
      },
    );

    await this.db('refresh_token').insert({
      user_id: user.id,
      token_hash: hashToken(refreshToken),
      jti: refreshJti,
      expires_at: new Date(Date.now() + this.config.jwt.refreshTtl * 1000),
      user_agent: userAgent?.slice(0, 255) ?? null,
      created_at: new Date(),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.jwt.accessTtl,
      tokenType: 'Bearer',
    };
  }

  async verifyRefresh(token: string): Promise<RefreshTokenPayload> {
    return this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.jwt.refreshSecret,
      issuer: this.config.jwt.issuer,
    });
  }

  async findValidRefreshRow(token: string): Promise<{ id: number; user_id: number; revoked_at: Date | null } | undefined> {
    return this.db('refresh_token').where({ token_hash: hashToken(token) }).first();
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await this.db('refresh_token')
      .where({ token_hash: hashToken(token) })
      .andWhere({ revoked_at: null })
      .update({ revoked_at: new Date() });
  }

  async revokeAllForUser(userId: number): Promise<void> {
    await this.db('refresh_token')
      .where({ user_id: userId })
      .andWhere({ revoked_at: null })
      .update({ revoked_at: new Date() });
  }

  /** 把 access token 的 jti 加入黑名单，TTL 与 access token 剩余有效期对齐 */
  async blacklistAccessToken(payload: AccessTokenPayload): Promise<void> {
    const ttl = Math.max(1, (payload.exp ?? 0) - Math.floor(Date.now() / 1000));
    await this.cache.set(`auth:blacklist:${payload.jti}`, true, ttl);
  }

  verifyAccess(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.jwt.accessSecret,
      issuer: this.config.jwt.issuer,
    });
  }
}
