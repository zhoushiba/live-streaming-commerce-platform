import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../../database/schema';

export const IS_PUBLIC_KEY = 'isPublic';
/** 标记接口无需登录即可访问（如登录、注册、支付回调） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** 角色要求：admin > anchor > viewer 的层级由 RolesGuard 统一判定 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: number;
  username: string;
  nickname?: string;
  role: UserRole;
  jti: string;
}

export interface AuthenticatedRequest {
  user: AuthUser;
  requestId?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  originalUrl: string;
}

/** 控制器里用 @CurrentUser() 直接拿当前登录用户 */
export const CurrentUser = createParamDecorator((field: keyof AuthUser | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  const user = request.user;
  if (!user) return null;
  return field ? user[field] : user;
});
