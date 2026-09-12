import http from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const COMMAND_DECK_TIMEOUT_MS = 4_000;

/**
 * Container healthcheck used by Compose. It never opens a listening port.
 * SQLite SELECT 1 is the default probe. When Command Deck is enabled, also
 * GET the loopback /api/status route.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ ok: boolean, code: number }>}
 */
export async function runDockerHealthcheck(env) {
  const databasePath = env.DATABASE_PATH?.trim() ?? '';
  if (databasePath === '') {
    return { ok: false, code: 1 };
  }

  try {
    const database = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      database.prepare('SELECT 1').get();
    } finally {
      database.close();
    }
  } catch {
    return { ok: false, code: 1 };
  }

  if (env.ADMIN_CONSOLE_ENABLED === 'true') {
    const host = env.ADMIN_CONSOLE_HOST?.trim() || '127.0.0.1';
    const port = Number(env.ADMIN_CONSOLE_PORT?.trim() || '8787');
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      return { ok: false, code: 1 };
    }

    const reachable = await probeCommandDeck(host, port);
    if (!reachable) {
      return { ok: false, code: 1 };
    }
  }

  return { ok: true, code: 0 };
}

/**
 * @param {string} host
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function probeCommandDeck(host, port) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host,
        port,
        path: '/api/status',
        timeout: COMMAND_DECK_TIMEOUT_MS,
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 500;
        resolve(status < 500);
      },
    );
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  void runDockerHealthcheck(process.env).then((result) => {
    process.exit(result.code);
  });
}
