import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @IsIn(['room', 'video', 'recharge'])
  bizType!: 'room' | 'video' | 'recharge';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId?: number;

  /** 仅充值使用；房间/点播金额一律由服务端按内容定价，防止客户端改价 */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10000)
  amount?: number;

  @IsString()
  @Length(8, 64, { message: 'idempotencyKey 长度需在 8-64 之间' })
  idempotencyKey!: string;
}

export class ListOrdersQuery {
  @IsOptional()
  @IsIn(['pending', 'paid', 'closed', 'refunded'])
  status?: 'pending' | 'paid' | 'closed' | 'refunded';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 10;
}
