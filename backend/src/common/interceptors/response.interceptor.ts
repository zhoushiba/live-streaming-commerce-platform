import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ErrorCode } from '../errors/error-code';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

/** 统一成功响应包装：controller 直接返回业务数据即可 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<{ requestId?: string }>();
    return next.handle().pipe(
      map((data) => ({
        code: ErrorCode.OK,
        message: 'ok',
        data,
        requestId: request?.requestId ?? '',
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
