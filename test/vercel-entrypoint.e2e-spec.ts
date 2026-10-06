import { execFileSync } from 'node:child_process';

describe('Vercel server entrypoint (e2e)', () => {
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
      import { Server } from 'node:http';
      import { io } from 'socket.io-client';

      const { default: server } = await import('./dist/main.js');
      assert.ok(server instanceof Server, 'entrypoint must export the HTTP server');
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
