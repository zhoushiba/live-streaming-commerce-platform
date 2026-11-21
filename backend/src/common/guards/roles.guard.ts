import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest, ROLES_KEY } from '../decorators/auth.decorators';
import { BizErrors } from '../errors/business.exception';
import { UserRole } from '../../database/schema';

/** 角色层级：admin 拥有 anchor 与 viewer 的全部权限 */
const ROLE_LEVEL: Record<UserRole, number> = { viewer: 1, anchor: 2, admin: 3 };

/**
 * 接口级角色鉴权（资源级鉴权在 service 里做：只能操作自己的房间/订单）。
 * 用法：@Roles('anchor', 'admin')
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;
    if (!role) throw BizErrors.tokenInvalid('请先登录');

    const userLevel = ROLE_LEVEL[role] ?? 0;
    const needLevel = Math.min(...required.map((r) => ROLE_LEVEL[r] ?? 99));
    if (userLevel < needLevel) {
      throw BizErrors.forbidden(`需要 ${required.join('/')} 角色才能访问`);
    }
    return true;
  }
}
