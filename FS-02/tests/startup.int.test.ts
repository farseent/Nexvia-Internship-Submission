import { type ChildProcess, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { freePort, requireInfraEnv } from './helpers.js';
// @ts-expect-error plain .mjs script without types
import { generateCollabKeyPair } from '../scripts/generate-collab-keys.mjs';

const infra = requireInfraEnv();

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function start(
  entry: string,
  env: Record<string, string>,
): { child: ChildProcess; logs: () => string; closed: Promise<ChildExit> } {
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    env: {
      PATH: process.env['PATH'] ?? '',
      ...(process.env['SystemRoot'] ? { SystemRoot: process.env['SystemRoot'] } : {}),
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      ...infra,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));

  // Subscribe immediately so a fast startup failure cannot race the close listener.
  const closed = new Promise<ChildExit>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

  return { child, logs: () => out, closed };
}

async function waitForOk(url: string, timeoutMs = 15_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastError = new Error(`status ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError)}`);
}

/**
 * Windows does not deliver catchable POSIX signals to child processes:
 * child.kill('SIGTERM') terminates the process directly. On POSIX, SIGTERM
 * is delivered to the Node.js handler and the application must exit cleanly.
 */
async function stop(child: ChildProcess, closed: Promise<ChildExit>): Promise<ChildExit> {
  if (child.exitCode === null && child.signalCode === null && !child.killed) {
    child.kill('SIGTERM');
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('child process did not exit after SIGTERM')),
          5_000,
        );
      }),
    ]);
  } catch (error) {
    // Do not leave a server process behind if graceful shutdown hangs.
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    if (error instanceof Error && error.message.includes('did not exit')) {
      return await closed;
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function expectShutdown(exit: ChildExit, logs: string): void {
  // Windows process termination does not expose a reliable POSIX exit code.
  // The close event itself proves the child has terminated; Linux CI checks
  // the graceful SIGTERM handler and its required zero exit code.
  if (process.platform === 'win32') {
    // stop() resolves only after the child's `close` event, proving termination.
    // Windows does not expose a meaningful POSIX-style graceful exit status here.
    return;
  }

  expect(exit.code, logs).toBe(0);
  expect(exit.signal, logs).toBeNull();
}

describe('real process startup and graceful shutdown', () => {
  it('api starts, serves /health and /ready, and shuts down', async () => {
    const port = await freePort();
    const { child, logs, closed } = start('apps/api/src/main.ts', {
      PORT: String(port),
      APP_URL: 'http://localhost:3000',
    });
    try {
      const health = await waitForOk(`http://127.0.0.1:${port}/health`);
      expect(await health.json()).toEqual({ status: 'ok', service: 'api' });
      const ready = await waitForOk(`http://127.0.0.1:${port}/ready`);
      expect(((await ready.json()) as { status: string }).status).toBe('ready');
    } finally {
      const exit = await stop(child, closed);
      expectShutdown(exit, logs());
    }
  });

  it('collab starts, serves /health and /ready, and shuts down', async () => {
    const port = await freePort();
    const keys = generateCollabKeyPair() as { COLLAB_JWT_PUBLIC_KEYS: string };
    const { child, logs, closed } = start('apps/collab/src/main.ts', {
      COLLAB_PORT: String(port),
      APP_URL: 'http://localhost:3000',
      COLLAB_JWT_PUBLIC_KEYS: keys.COLLAB_JWT_PUBLIC_KEYS,
    });
    try {
      const health = await waitForOk(`http://127.0.0.1:${port}/health`);
      expect(await health.json()).toEqual({ status: 'ok', service: 'collab' });
      const ready = await waitForOk(`http://127.0.0.1:${port}/ready`);
      expect(((await ready.json()) as { status: string }).status).toBe('ready');
    } finally {
      const exit = await stop(child, closed);
      expectShutdown(exit, logs());
    }
  });
});
