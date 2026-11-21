import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators';
import { DanmakuService } from './danmaku.service';

@ApiTags('弹幕')
@Controller('rooms/:roomId/danmaku')
export class DanmakuController {
  constructor(private readonly danmakuService: DanmakuService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '拉取房间历史弹幕（WebSocket 连上前的补屏）' })
  history(@Param('roomId', ParseIntPipe) roomId: number, @Query('limit') limit?: string) {
    return this.danmakuService.history(roomId, limit ? Number(limit) : undefined);
  }
}
