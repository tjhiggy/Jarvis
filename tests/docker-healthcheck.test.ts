import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const scriptPath = join(process.cwd(), 'scripts/docker-healthcheck.mjs');

async function runHealthcheck(
  env: NodeJS.ProcessEnv,
): Promise<{ code: number }> {
  try {
    await executeFile(process.execPath, [scriptPath], {
      env: { ...process.env, ...env },
    });
    return { code: 0 };
  } catch (error) {
    const failure = error as { code?: number };
    return { code: typeof failure.code === 'number' ? failure.code : 1 };
  }
}

describe('docker healthcheck', () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-docker-health-'));
    databasePath = join(directory, 'discord-bot.db');
    const database = new Database(databasePath);
    database.prepare('SELECT 1').get();
    database.close();
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('fails closed without DATABASE_PATH', async () => {
    await expect(runHealthcheck({ DATABASE_PATH: '' })).resolves.toEqual({
      code: 1,
    });
  });

  it('fails when the SQLite file is missing', async () => {
    await expect(
      runHealthcheck({
        DATABASE_PATH: join(directory, 'missing.db'),
      }),
    ).resolves.toEqual({ code: 1 });
  });

  it('passes a SQLite SELECT 1 against DATABASE_PATH', async () => {
    await expect(
      runHealthcheck({ DATABASE_PATH: databasePath }),
    ).resolves.toEqual({ code: 0 });
  });

  it('probes Command Deck on loopback when the console is enabled', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"database":"healthy"}');
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('expected a TCP address'));
          return;
        }
        resolve(address.port);
      });
    });

    try {
      await expect(
        runHealthcheck({
          DATABASE_PATH: databasePath,
          ADMIN_CONSOLE_ENABLED: 'true',
          ADMIN_CONSOLE_HOST: '127.0.0.1',
          ADMIN_CONSOLE_PORT: String(port),
        }),
      ).resolves.toEqual({ code: 0 });

      await expect(
        runHealthcheck({
          DATABASE_PATH: databasePath,
          ADMIN_CONSOLE_ENABLED: 'true',
          ADMIN_CONSOLE_HOST: '127.0.0.1',
          ADMIN_CONSOLE_PORT: '1',
        }),
      ).resolves.toEqual({ code: 1 });
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
