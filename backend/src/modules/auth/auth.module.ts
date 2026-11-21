import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * 认证模块：JwtModule 注册为全局，守卫可直接注入 JwtService。
 * Access/Refresh 使用不同密钥，避免用 access 密钥签出 refresh。
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwt.accessSecret,
        signOptions: { issuer: config.jwt.issuer },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [AuthService, TokenService, JwtModule],
})
export class AuthModule {}
