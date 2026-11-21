import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { StreamService } from './stream.service';

@ApiTags('流媒体')
@Controller('streams')
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  @Public()
  @Get(':roomId/play-info')
  @ApiOperation({ summary: '播放信息：HLS 多清晰度 + FLV 兜底 + 演示模式' })
  playInfo(
    @Param('roomId', ParseIntPipe) roomId: number,
    @Query('quality') quality: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.streamService.getPlayInfo(roomId, user, quality);
  }

  @Public()
  @Get(':roomId/health')
  @ApiOperation({ summary: '开播探测（播放器断流判定用）' })
  health(@Param('roomId', ParseIntPipe) roomId: number) {
    return this.streamService.health(roomId);
  }

  @Get(':roomId/push-info')
  @ApiBearerAuth()
  @ApiOperation({ summary: '推流地址与串流密钥（房主/管理员）' })
  pushInfo(@Param('roomId', ParseIntPipe) roomId: number, @CurrentUser() user: AuthUser) {
    return this.streamService.getPushInfo(roomId, user);
  }

  @Get(':roomId/stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: '直播数据看板（房主/管理员）' })
  stats(@Param('roomId', ParseIntPipe) roomId: number, @CurrentUser() user: AuthUser) {
    return this.streamService.getRoomStats(roomId, user);
  }
}
