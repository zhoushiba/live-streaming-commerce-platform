import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCode } from '../errors/error-code';

interface ErrorPayload {
  bizCode?: number;
  message?: string | string[];
  details?: unknown;
}

/**
 * 全局异常过滤器：把任何异常收敛成统一响应体
 * { code, message, details?, path, requestId, timestamp }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let bizCode: number = ErrorCode.INTERNAL_ERROR;
    let message = '服务器开小差了，请稍后重试';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
        bizCode = status === HttpStatus.NOT_FOUND ? ErrorCode.RESOURCE_NOT_FOUND : bizCode;
      } else {
        const body = payload as ErrorPayload;
        bizCode = body.bizCode ?? this.mapHttpStatusToCode(status);
        const raw = body.message;
        message = Array.isArray(raw) ? raw.join('；') : (raw ?? exception.message);
        details = body.details;
      }
    } else if (exception instanceof Error) {
      message = exception.message || message;
      this.logger.error(`${request.method} ${request.originalUrl} -> ${exception.message}`, exception.stack);
    }

    const body: Record<string, unknown> = {
      code: bizCode,
      message,
      path: request.originalUrl,
      requestId: request.requestId ?? '',
      timestamp: new Date().toISOString(),
    };
    if (details !== undefined) body.details = details;

    response.status(status).json(body);
  }

  private mapHttpStatusToCode(status: number): number {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.TOKEN_INVALID;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED;
      case HttpStatus.PAYMENT_REQUIRED:
        return ErrorCode.ENTITLEMENT_REQUIRED;
      default:
        return ErrorCode.INTERNAL_ERROR;
    }
  }
}
