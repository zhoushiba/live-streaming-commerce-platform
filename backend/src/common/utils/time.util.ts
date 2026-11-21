/**
 * 时间工具：SQLite 里 timestamp 读出来是字符串，MySQL 是 Date 对象，
 * 统一在这里归一，避免序列化结果因数据库不同而漂移。
 */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T');
  const withZone = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIso(value: unknown): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

export function toEpochMs(value: unknown): number | null {
  const date = toDate(value);
  return date ? date.getTime() : null;
}

export function addSeconds(base: Date, seconds: number): Date {
  return new Date(base.getTime() + seconds * 1000);
}

export function addMinutes(base: Date, minutes: number): Date {
  return addSeconds(base, minutes * 60);
}
