import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @IsString({ message: '用户名必须是字符串' })
  @Length(4, 20, { message: '用户名长度需在 4-20 之间' })
  @Matches(/^[a-zA-Z0-9_]+$/, { message: '用户名只能包含字母、数字与下划线' })
  username!: string;

  @IsString()
  @Length(8, 32, { message: '密码长度需在 8-32 之间' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '密码必须同时包含字母和数字' })
  password!: string;

  @IsOptional()
  @IsString()
  @Length(2, 20, { message: '昵称长度需在 2-20 之间' })
  nickname?: string;

  @IsOptional()
  @IsIn(['viewer', 'anchor'], { message: '注册角色只能是观众或主播' })
  role?: 'viewer' | 'anchor';
}

export class LoginDto {
  @IsString()
  @Length(4, 20)
  username!: string;

  @IsString()
  @Length(8, 32)
  password!: string;
}

export class RefreshTokenDto {
  @IsString({ message: 'refreshToken 不能为空' })
  @Length(20, 400)
  refreshToken!: string;
}

export class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
