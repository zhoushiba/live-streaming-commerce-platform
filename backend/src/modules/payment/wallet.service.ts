import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../../database/knex.factory';
import { TABLES } from '../../database/schema';
import { BizErrors } from '../../common/errors/business.exception';
import { buildPage, PageResult } from '../../common/dto/pagination.dto';
import { round2 } from '../../common/utils/money.util';

/**
 * 钱包读取层：数据库金额列本身已是「元」的 DECIMAL(12,2)，
 * 这里只做 round2 归一化，**不能**再调用 toYuan()（那是「分 → 元」的换算，会二次除以 100）。
 */
@Injectable()
export class WalletService {
  constructor(@Inject(KNEX) private readonly knex: Knex) {}

  async getWallet(userId: number): Promise<Record<string, unknown>> {
    const wallet = await this.knex(TABLES.userBalance).where({ user_id: userId }).first();
    if (!wallet) throw BizErrors.notFound('钱包不存在');
    return {
      userId,
      balance: round2(wallet.balance),
      totalRecharge: round2(wallet.total_recharge),
      totalConsume: round2(wallet.total_consume),
      version: wallet.version,
      updatedAt: new Date(wallet.updated_at).toISOString(),
    };
  }

  async listTransactions(userId: number, page: number, pageSize: number): Promise<PageResult<Record<string, unknown>>> {
    const base = this.knex(TABLES.balanceTransaction).where({ user_id: userId });
    const [{ total }] = await base.clone().count<{ total: number }[]>({ total: '*' });
    const rows = await base
      .clone()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return buildPage(
      rows.map((row) => ({
        id: Number(row.id),
        bizType: row.biz_type,
        amount: round2(row.amount),
        balanceAfter: round2(row.balance_after),
        bizNo: row.biz_no,
        remark: row.remark,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      Number(total),
      page,
      pageSize,
    );
  }
}
