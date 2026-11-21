import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { resolveRequestId } from '../utils/id.util';

/** 给每个请求打上链路 ID，响应头回传，便于前后端联调与日志检索 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request & { requestId?: string }, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req.header('x-request-id'));
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const startedAt = Date.now();
    res.on('finish', () => {
      const cost = Date.now() - startedAt;
      const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${cost}ms`;
      if (res.statusCode >= 500) this.logger.error(line);
      else if (res.statusCode >= 400) this.logger.warn(line);
      else this.logger.log(line);
    });
    next();
  }
}
