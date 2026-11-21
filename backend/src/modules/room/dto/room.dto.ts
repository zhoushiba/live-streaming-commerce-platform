import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ListRoomsQuery {
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
  pageSize?: number = 12;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsIn(['idle', 'living', 'ended'])
  status?: 'idle' | 'living' | 'ended';

  @IsOptional()
  @IsString()
  @Length(1, 30)
  keyword?: string;

  @IsOptional()
  @IsIn(['hot', 'new', 'price_asc', 'price_desc'])
  sort?: 'hot' | 'new' | 'price_asc' | 'price_desc';
}

export class CreateRoomDto {
  @IsString()
  @Length(2, 60, { message: '直播间标题需在 2-60 字之间' })
  title!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  coverUrl?: string;

  @IsOptional()
  @IsIn(['free', 'monthly', 'yearly'], { message: 'priceType 只能是 free/monthly/yearly' })
  priceType?: 'free' | 'monthly' | 'yearly';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999)
  price?: number;
}

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  coverUrl?: string;

  @IsOptional()
  @IsIn(['free', 'monthly', 'yearly'])
  priceType?: 'free' | 'monthly' | 'yearly';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999)
  price?: number;
}
