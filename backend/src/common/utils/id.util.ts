import { randomBytes, randomUUID } from 'crypto';

/** 请求链路 ID：优先透传 x-request-id，便于日志聚合 */
export function resolveRequestId(headerValue?: string): string {
  if (headerValue && /^[\w-]{8,64}$/.test(headerValue)) return headerValue;
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

/** 订单号：yyyyMMddHHmmss + 6 位随机，保证可读且低碰撞 */
export function generateOrderNo(prefix = 'LO'): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}${stamp}${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** 支付流水号（发给支付渠道的 out_trade_no），前缀区分渠道便于对账 */
export function generateOutTradeNo(provider: string): string {
  return `${provider.toUpperCase()}${generateOrderNo('T')}`;
}

export function generateRefundNo(): string {
  return generateOrderNo('RF');
}

/** 数据库唯一约束冲突判定：SQLite 与 MySQL 的错误文案不同，这里统一识别 */
export function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  if (!err) return false;
  const code = err.code ?? '';
  const message = err.message ?? '';
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'ER_DUP_ENTRY' ||
    message.includes('UNIQUE constraint failed') ||
    message.includes('Duplicate entry')
  );
}
