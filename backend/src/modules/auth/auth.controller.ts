import { Body, Controller, Get, Headers, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { CurrentUser, Public, AuthUser, AuthenticatedRequest } from '../../common/decorators/auth.decorators';
import { AuthService } from './auth.service';
import { LoginDto, LogoutDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 20)
  nickname?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  avatar?: string;
}

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: '注册（观众/主播）' })
  register(@Body() dto: RegisterDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.register(dto, userAgent);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: '登录，返回 Access(15m) + Refresh(7d)' })
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto, userAgent);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '刷新令牌（轮换，旧 refresh 立即失效）' })
  refresh(@Body() dto: RefreshTokenDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.refresh(dto.refreshToken, userAgent);
  }

  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出：access 进黑名单 + 吊销 refresh' })
  logout(
    @Req() req: AuthenticatedRequest,
    @Body() dto: LogoutDto,
    @Headers('authorization') authorization?: string,
  ) {
    const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
    void req;
    return this.authService.logout(accessToken, dto.refreshToken);
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前登录用户信息（含钱包余额）' })
  profile(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user.id);
  }

  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改昵称/头像' })
  async updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    await this.authService.assertUserActive(user.id);
    return this.authService.updateProfile(user.id, dto);
  }
}
