import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public, Roles } from '../../common/decorators/auth.decorators';
import { CreateRoomDto, ListRoomsQuery, UpdateRoomDto } from './dto/room.dto';
import { RoomService } from './room.service';

@ApiTags('直播间')
@Controller('rooms')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: '直播分类' })
  categories() {
    return this.roomService.listCategories();
  }

  @Public()
  @Get()
  @ApiOperation({ summary: '直播间列表（分页 / 分类 / 排序 / 关键词）' })
  list(@Query() query: ListRoomsQuery) {
    return this.roomService.listRooms(query);
  }

  @Get('mine')
  @ApiBearerAuth()
  @Roles('anchor', 'admin')
  @ApiOperation({ summary: '主播中心：我的直播间' })
  mine(@CurrentUser() user: AuthUser) {
    return this.roomService.listMyRooms(user);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '直播间详情（含当前用户观看权限）' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.roomService.getRoomDetail(id, user);
  }

  @Post()
  @ApiBearerAuth()
  @Roles('anchor', 'admin')
  @ApiOperation({ summary: '创建直播间（主播自动入驻）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoomDto) {
    return this.roomService.createRoom(user, dto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @Roles('anchor', 'admin')
  @ApiOperation({ summary: '编辑直播间（仅房主）' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomService.updateRoom(user, id, dto);
  }

  @Post(':id/live/start')
  @ApiBearerAuth()
  @Roles('anchor', 'admin')
  @ApiOperation({ summary: '开播' })
  start(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.roomService.startLive(user, id);
  }

  @Post(':id/live/end')
  @ApiBearerAuth()
  @Roles('anchor', 'admin')
  @ApiOperation({ summary: '下播' })
  end(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.roomService.endLive(user, id);
  }

  @Post(':id/like')
  @ApiBearerAuth()
  @ApiOperation({ summary: '点赞' })
  like(@Param('id', ParseIntPipe) id: number) {
    return this.roomService.likeRoom(id);
  }

  @Post(':id/enter')
  @ApiBearerAuth()
  @ApiOperation({ summary: '进入直播间（在线人数 +1，记录观看历史）' })
  enter(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.roomService.enterRoom(id, user);
  }
}
