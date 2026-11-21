import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { CacheService } from '../../infra/cache/cache.service';
import { AuthUser, AuthenticatedRequest, IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { BizError, BizErrors } from '../errors/business.exception';
import { ErrorCode } from '../errors/error-code';
import { AccessTokenPayload } from '../../modules/auth/token.service';
import { UserRole } from '../../database/schema';

/**
 * 全局 JWT 守卫：
 *  1. @Public() 接口放行，但若带了合法 token 仍会填充 req.user（游客/登录态共用接口）
 *  2. 校验签名、issuer、type=access、黑名单（登出后的 access token 立即失效）
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]) ?? false;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { headers: Record<string, any> }>();
    const header = request.headers?.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) {
      if (isPublic) return true;
      throw BizErrors.tokenInvalid('缺少访问令牌');
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwt.accessSecret,
        issuer: this.config.jwt.issuer,
      });
      if (payload.type !== 'access') throw new Error('token type mismatch');
      const blacklisted = await this.cache.get<boolean>(`auth:blacklist:${payload.jti}`);
      if (blacklisted) throw new BizError(ErrorCode.TOKEN_INVALID, '令牌已被注销', 401);
      const user: AuthUser = {
        id: payload.sub,
        username: payload.username,
        role: payload.role as UserRole,
        jti: payload.jti,
      };
      request.user = user;
      return true;
    } catch (error) {
      if (isPublic) return true;
      if (error instanceof BizError) throw error;
      if (error instanceof UnauthorizedException) throw error;
      if ((error as Error).name === 'TokenExpiredError') throw BizErrors.tokenExpired();
      throw BizErrors.tokenInvalid('令牌无效或已过期');
    }
  }
}
