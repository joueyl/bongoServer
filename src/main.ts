import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 允许前端跨域联调（REST 与 WebSocket 均放开）
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
