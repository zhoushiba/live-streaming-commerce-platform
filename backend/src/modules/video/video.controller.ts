import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { VideoService } from './video.service';

@ApiTags('点播')
@Controller('videos')
export class VideoController {
  constructor(private readonly video: VideoService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '点播列表（支持关键词 / 分类 / 分页）' })
  list(@Query() query: Record<string, string>) {
    return this.video.list({
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      keyword: query.keyword,
      categoryId: query.categoryId ? Number(query.categoryId) : undefined,
    });
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: '视频详情 + 剧集解锁状态（登录后可见已购剧集地址）' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user?: AuthUser) {
    return this.video.detail(id, user);
  }

  @ApiBearerAuth()
  @Post(':id/episodes/:episodeId/play')
  @ApiOperation({ summary: '获取剧集播放地址（服务端校验权益）' })
  play(
    @Param('id', ParseIntPipe) id: number,
    @Param('episodeId', ParseIntPipe) episodeId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.video.playEpisode(id, episodeId, user);
  }
}
