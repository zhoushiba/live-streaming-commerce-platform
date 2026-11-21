import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import { AdminService } from './admin.service';
import { PaymentProviderCode } from '../payment/dto/payment.dto';

class SetUserStatusDto {
  @IsIn(['active', 'disabled'])
  status!: 'active' | 'disabled';
}

class ReconcileDto {
  @IsOptional()
  @IsString()
  billDate?: string;

  @IsOptional()
  @IsIn(['mock', 'wechat', 'alipay'])
  provider?: PaymentProviderCode;
}

@ApiTags('管理后台')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: '运营看板（用户/直播间/订单/营收/弹幕）' })
  stats() {
    return this.admin.stats();
  }

  @Get('users')
  @ApiOperation({ summary: '用户列表' })
  users(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('keyword') keyword?: string) {
    return this.admin.listUsers(Number(page) || 1, Math.min(100, Number(pageSize) || 20), keyword);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: '启用 / 禁用用户' })
  setStatus(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SetUserStatusDto) {
    return this.admin.setUserStatus(user.id, id, dto.status);
  }

  @Get('orders')
  @ApiOperation({ summary: '订单列表（可按状态过滤）' })
  orders(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.admin.listOrders(Number(page) || 1, Math.min(100, Number(pageSize) || 20), status);
  }

  @Get('rooms')
  @ApiOperation({ summary: '直播间列表（含 streamKey）' })
  rooms(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.admin.listRooms(Number(page) || 1, Math.min(100, Number(pageSize) || 20), status);
  }

  @Post('rooms/:id/close')
  @ApiOperation({ summary: '强制下播' })
  forceClose(@Param('id', ParseIntPipe) id: number) {
    return this.admin.forceEndLive(id);
  }

  @Post('danmaku/:id/hide')
  @ApiOperation({ summary: '下架违规弹幕' })
  hideDanmaku(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.admin.hideDanmaku(id, user.id);
  }

  @Post('reconciliation')
  @ApiOperation({ summary: '触发对账（默认昨天、mock 渠道）' })
  reconcile(@Body() dto: ReconcileDto) {
    const billDate = dto.billDate ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    return this.admin.reconcile(billDate, dto.provider ?? 'mock');
  }

  @Get('reconciliation')
  @ApiOperation({ summary: '对账记录' })
  reconciliations() {
    return this.admin.listReconciliations();
  }
}
