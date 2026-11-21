import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { GiftService } from './gift.service';

class SendGiftDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roomId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  giftId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  count!: number;

  @IsString()
  @Length(8, 64)
  requestId!: string;
}

@ApiTags('礼物')
@Controller('gifts')
export class GiftController {
  constructor(private readonly giftService: GiftService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '礼物列表' })
  list() {
    return this.giftService.listGifts();
  }

  @Public()
  @Get('leaderboard/:roomId')
  @ApiOperation({ summary: '房间礼物榜' })
  leaderboard(@Param('roomId', ParseIntPipe) roomId: number, @Query('limit') limit?: string) {
    return this.giftService.leaderboard(roomId, limit ? Number(limit) : 10);
  }

  @Post('send')
  @ApiBearerAuth()
  @ApiOperation({ summary: '送礼（余额原子扣减 + requestId 幂等）' })
  send(@CurrentUser() user: AuthUser, @Body() dto: SendGiftDto) {
    return this.giftService.send(user, dto);
  }

  @Get('mine')
  @ApiBearerAuth()
  @ApiOperation({ summary: '我送出的礼物' })
  mine(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.giftService.myRecords(user.id, Number(page ?? 1), Number(pageSize ?? 20));
  }
}
