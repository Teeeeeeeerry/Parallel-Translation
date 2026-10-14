import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';

const serverPath = path.resolve('docs/testing/e2e/fixtures-server.mjs');
const children: ChildProcess[] = [];

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('未能分配测试端口');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

async function waitForHealth(port: number): Promise<Response> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__fixture-health`);
      if (response.ok) return response;
    } catch {
      // 进程尚未监听；下一轮继续探测。
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('夹具服务器未在测试时限内就绪');
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await once(child, 'exit');
  }));
});

describe('fixtures server', () => {
  it('reports readiness over HTTP and writes a lifecycle shutdown record', async () => {
    const port = await freePort();
    let stderr = '';
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });

    const response = await waitForHealth(port);
    expect(await response.json()).toMatchObject({ status: 'ok', pid: child.pid });

    child.kill('SIGTERM');
    await once(child, 'exit');
    expect(stderr).toContain('fixture-server event=shutdown');
    expect(stderr).toContain('exitCode=0');
  });

  it('reports an occupied listen port and exits instead of hanging', async () => {
    const port = await freePort();
    const holder = createServer().listen(port);
    await once(holder, 'listening');
    let stderr = '';
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    const [code] = await once(child, 'exit');
    await new Promise<void>((resolve) => holder.close(() => resolve()));
    expect(code).toBe(1);
    expect(stderr).toContain('fixture-server event=listen-error');
  });
});
