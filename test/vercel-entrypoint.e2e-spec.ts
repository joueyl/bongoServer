import { execFileSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';

describe('Vercel server entrypoint (e2e)', () => {
  it('explicitly includes the optional gateway module in the deployment', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(config.functions).toBeUndefined();
    const build = config.builds.find(
      (entry: { src: string }) => entry.src === 'src/main.ts',
    );
    expect(build.use).toBe('@vercel/node@17.0.0');
    expect(config.routes).toEqual([{ src: '/(.*)', dest: '/src/main.ts' }]);
    const files = globSync(build.config.includeFiles);
    expect(
      files.some((file) =>
        file
          .replaceAll('\\', '/')
          .endsWith('/@nestjs/websockets/socket-module.js'),
      ),
    ).toBe(true);
  });

  beforeAll(() => {
    execFileSync(
      process.execPath,
      ['node_modules/@nestjs/cli/bin/nest.js', 'build'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        stdio: 'pipe',
      },
    );
  }, 35000);

  it('exports an initialized HTTP server with REST and WebSocket handlers', () => {
    const script = `
      import assert from 'node:assert/strict';
      import http, { Server } from 'node:http';
      import { io } from 'socket.io-client';

      // Match Vercel's listen capture while importing the application.
      const originalListen = http.Server.prototype.listen;
      let captured;
      http.Server.prototype.listen = function () {
        captured = this;
        http.Server.prototype.listen = originalListen;
        return this;
      };
      const { default: server } = await import('./dist/main.js');
      http.Server.prototype.listen = originalListen;
      assert.ok(server instanceof Server, 'entrypoint must export the HTTP server');
      assert.equal(captured, server, 'Vercel must capture the initialized HTTP server');
      assert.equal(server.listening, false, 'Vercel owns the listening socket');
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = 'http://127.0.0.1:' + server.address().port;
      const response = await fetch(base + '/test');
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);

      const socket = io(base + '/bangocat', {
        transports: ['websocket'], reconnection: false, timeout: 2000,
      });
      try {
        await new Promise((resolve, reject) => {
          socket.once('connect', resolve);
          socket.once('connect_error', reject);
        });
        const reply = await socket.timeout(2000).emitWithAck('room:state');
        assert.equal(typeof reply.ok, 'boolean');
      } finally {
        socket.disconnect();
        await new Promise(resolve => server.close(resolve));
      }
      console.log('REST and WebSocket entrypoint verified');
      process.exit(0);
    `;
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: process.cwd(),
        env: { ...process.env, VERCEL: '1', PORT: '0' },
        timeout: 8000,
        encoding: 'utf8',
      },
    );
    expect(output).toContain('REST and WebSocket entrypoint verified');
  }, 10000);
});
