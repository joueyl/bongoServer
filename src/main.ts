import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
// Keep Nest's optional gateway module visible to deployment file tracing.
import '@nestjs/websockets/socket-module.js';
import type { Server } from 'node:http';
import { AppModule } from './app.module.js';
import { BangocatGateway } from './bangocat/bangocat.gateway.js';

console.info('[startup] Creating Nest application');
const app = await NestFactory.create(AppModule, { abortOnError: false });
app.enableCors();
app.useWebSocketAdapter(new IoAdapter(app));
console.info('[startup] Initializing HTTP routes and Socket.IO');
await app.init();

if (!app.get(BangocatGateway).server) {
  throw new Error('Socket.IO gateway was not initialized');
}

// Export the original server, including its Socket.IO request/upgrade listeners.
const server: Server = app.getHttpServer();
export default server;

server.on('error', (error: Error) => {
  console.error('Failed to start server', error);
  process.exitCode = 1;
});
// Nest is already initialized. Let Vercel capture the synchronous listen call
// without creating a Nest listen promise whose callback never runs there.
console.info('[startup] HTTP server ready for listen capture');
server.listen(process.env.PORT ?? 3000);
console.info('[startup] Entrypoint initialization complete');
