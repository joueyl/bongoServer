import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
// Keep Nest's optional gateway module visible to deployment file tracing.
import '@nestjs/websockets/socket-module.js';
import type { Server } from 'node:http';
import { AppModule } from './app.module.js';
import { BangocatGateway } from './bangocat/bangocat.gateway.js';

const app = await NestFactory.create(AppModule);
app.enableCors();
app.useWebSocketAdapter(new IoAdapter(app));
await app.init();

if (!app.get(BangocatGateway).server) {
  throw new Error('Socket.IO gateway was not initialized');
}

// Export the original server, including its Socket.IO request/upgrade listeners.
const server: Server = app.getHttpServer();
export default server;

if (process.env.VERCEL !== '1') {
  void app.listen(process.env.PORT ?? 3000).catch((error: unknown) => {
    console.error('Failed to start server', error);
    process.exitCode = 1;
  });
}
