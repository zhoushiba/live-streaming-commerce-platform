import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppModule } from './app.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { APP_CONFIG, AppConfig, resolvePath } from './config/app-config';
import { KNEX } from './database/knex.factory';
import { seedDatabase } from './database/seed';
import { Knex } from 'knex';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.setGlobalPrefix(config.apiPrefix);
  // 链路 ID：越早挂越好，后续守卫/异常过滤器/响应包装都能读到 req.requestId。
  // 用 app.use 而不是 Module.configure，是为了在 Express 5 的通配路由语法差异下保持稳定。
  const requestIdMiddleware = new RequestIdMiddleware();
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization,X-Request-Id',
    exposedHeaders: 'X-Request-Id',
  });
  app.enableShutdownHooks();

  // 本地静态媒体：HLS 切片 / FLV 文件 / 上传封面；生产应替换为 CDN
  const storageDir = resolvePath('./storage');
  for (const dir of ['media/demo', 'media/live', 'uploads', 'sandbox']) {
    fs.mkdirSync(path.join(storageDir, dir), { recursive: true });
  }
  app.useStaticAssets(path.join(storageDir, 'media'), { prefix: '/media/' });
  app.useStaticAssets(path.join(storageDir, 'uploads'), { prefix: '/uploads/' });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Live Streaming Commerce Platform API')
    .setDescription(
      '直播 + 点播付费内容平台：JWT 双令牌、直播间/推拉流、WebSocket 弹幕、礼物、订单、三方支付（Mock/微信 V3/支付宝）与权益发放。',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addTag('系统')
    .addTag('认证')
    .addTag('直播间')
    .addTag('推拉流')
    .addTag('弹幕')
    .addTag('礼物')
    .addTag('订单')
    .addTag('支付')
    .addTag('钱包')
    .addTag('权益')
    .addTag('点播')
    .addTag('管理后台')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: '直播电商平台 API 文档',
  });

  if (config.seed.seedOnBoot) {
    const db = app.get<Knex>(KNEX);
    await seedDatabase(db, config, (msg) => logger.log(`[seed] ${msg}`));
  }

  await app.listen(config.port, '0.0.0.0');
  logger.log(`API 已启动：http://localhost:${config.port}/${config.apiPrefix}`);
  logger.log(`Swagger：http://localhost:${config.port}/${config.apiPrefix}/docs`);
  logger.log(`媒体目录：${path.join(storageDir, 'media')}（HLS/FLV 由 /media 静态托管）`);
  logger.log(`数据库：${config.db.client} ${config.db.client === 'sqlite' ? config.db.filename : config.db.database}`);
}

bootstrap().catch((error) => {
  // 启动失败必须退出非零，便于容器与 CI 感知
  const logger = new Logger('Bootstrap');
  logger.error(`启动失败：${(error as Error).message}`, (error as Error).stack);
  process.exit(1);
});
