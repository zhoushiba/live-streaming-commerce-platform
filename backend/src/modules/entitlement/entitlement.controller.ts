import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/auth.decorators';
import { EntitlementService } from './entitlement.service';

@ApiTags('权益')
@ApiBearerAuth()
@Controller('entitlements')
export class EntitlementController {
  constructor(private readonly entitlementService: EntitlementService) {}

  @Get('mine')
  @ApiOperation({ summary: '我的全部权益（直播会员 / 点播单片）' })
  mine(@CurrentUser() user: AuthUser) {
    return this.entitlementService.listMine(user.id);
  }

  @Get('videos')
  @ApiOperation({ summary: '我购买的付费点播' })
  videos(@CurrentUser() user: AuthUser) {
    return this.entitlementService.listMyVideos(user.id);
  }
}
