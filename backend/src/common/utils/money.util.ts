/**
 * 金额工具：对外统一用「元」的小数，内部参与比较时先转成「分」的整数，避免浮点误差。
 * 数据库层面金额是 DECIMAL(12,2)，加减一律在 SQL 里完成。
 */
export function toCents(yuan: number | string): number {
  const value = typeof yuan === 'string' ? Number.parseFloat(yuan) : yuan;
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

export function toYuan(cents: number): number {
  return Math.round(cents) / 100;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: number | string): string {
  return round2(typeof value === 'string' ? Number.parseFloat(value) : value).toFixed(2);
}

export function amountEquals(a: number | string, b: number | string): boolean {
  return toCents(a) === toCents(b);
}
