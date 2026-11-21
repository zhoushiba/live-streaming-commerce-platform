import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorCodeValue } from './error-code';

/**
 * 业务异常：携带业务码 + HTTP 状态码，由 AllExceptionsFilter 统一渲染。
 * 用法：throw new BizError(ErrorCode.INSUFFICIENT_BALANCE, '余额不足', HttpStatus.CONFLICT)
 */
export class BizError extends HttpException {
  constructor(
    public readonly bizCode: ErrorCodeValue | number,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ bizCode, message, details }, status);
  }
}

export class BizErrors {
  static invalidCredentials(message = '用户名或密码错误'): BizError {
    return new BizError(ErrorCode.INVALID_CREDENTIALS, message, HttpStatus.UNAUTHORIZED);
  }
  static accountLocked(minutes: number): BizError {
    return new BizError(
      ErrorCode.ACCOUNT_LOCKED,
      `登录失败次数过多，账号已锁定 ${minutes} 分钟`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  static tokenInvalid(message = '令牌无效'): BizError {
    return new BizError(ErrorCode.TOKEN_INVALID, message, HttpStatus.UNAUTHORIZED);
  }
  static tokenExpired(): BizError {
    return new BizError(ErrorCode.TOKEN_EXPIRED, '登录已过期，请重新登录', HttpStatus.UNAUTHORIZED);
  }
  static refreshRevoked(): BizError {
    return new BizError(ErrorCode.REFRESH_TOKEN_REVOKED, '刷新令牌已失效', HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = '无权访问该资源'): BizError {
    return new BizError(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
  static notFound(message = '资源不存在'): BizError {
    return new BizError(ErrorCode.RESOURCE_NOT_FOUND, message, HttpStatus.NOT_FOUND);
  }
  static roomInvalidState(message: string): BizError {
    return new BizError(ErrorCode.ROOM_INVALID_STATE, message, HttpStatus.CONFLICT);
  }
  static orderStateInvalid(message: string): BizError {
    return new BizError(ErrorCode.ORDER_STATE_INVALID, message, HttpStatus.CONFLICT);
  }
  static paymentSignatureInvalid(message = '支付回调验签失败'): BizError {
    return new BizError(ErrorCode.PAYMENT_SIGNATURE_INVALID, message, HttpStatus.BAD_REQUEST);
  }
  static paymentAmountMismatch(): BizError {
    return new BizError(ErrorCode.PAYMENT_AMOUNT_MISMATCH, '回调金额与订单金额不一致', HttpStatus.CONFLICT);
  }
  static paymentProviderInvalid(message = '不支持的支付渠道'): BizError {
    return new BizError(ErrorCode.PAYMENT_PROVIDER_INVALID, message, HttpStatus.BAD_REQUEST);
  }
  static orderExpired(): BizError {
    return new BizError(ErrorCode.ORDER_EXPIRED, '订单已超时关闭，请重新下单', HttpStatus.CONFLICT);
  }
  static insufficientBalance(message = '余额不足，请先充值'): BizError {
    return new BizError(ErrorCode.INSUFFICIENT_BALANCE, message, HttpStatus.CONFLICT);
  }
  static entitlementRequired(message = '该内容需要购买后观看'): BizError {
    return new BizError(ErrorCode.ENTITLEMENT_REQUIRED, message, HttpStatus.PAYMENT_REQUIRED);
  }
  static sensitiveWord(message = '弹幕包含敏感词，已被拦截'): BizError {
    return new BizError(ErrorCode.DANMAKU_SENSITIVE, message, HttpStatus.BAD_REQUEST);
  }
  static invalidParameter(message = '参数不合法'): BizError {
    return new BizError(ErrorCode.INVALID_PARAMETER, message, HttpStatus.BAD_REQUEST);
  }
  static paymentChannelError(message = '支付渠道调用失败'): BizError {
    return new BizError(ErrorCode.INTERNAL_ERROR, message, HttpStatus.BAD_GATEWAY);
  }
  static rateLimited(message = '操作过于频繁，请稍后再试'): BizError {
    return new BizError(ErrorCode.RATE_LIMITED, message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
