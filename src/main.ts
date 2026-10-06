import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 允许前端跨域联调（REST 与 WebSocket 均放开）
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
// Vercel captures listen() during module loading and starts the server afterward.
// Awaiting bootstrap at module scope would block that startup sequence.
void bootstrap().catch((error: unknown) => {
  console.error('Failed to start server', error);
  process.exitCode = 1;
});
