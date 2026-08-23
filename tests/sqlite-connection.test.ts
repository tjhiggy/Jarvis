import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  initializeSqliteDatabase,
  openSqliteDatabase,
} from '../src/storage/open-sqlite-database.js';

describe('shared SQLite connection ownership', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it('creates nested directories and applies the shared connection pragmas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-sqlite-open-'));
    directories.push(directory);
    const databasePath = join(directory, 'nested', 'jarvis.db');

    const database = openSqliteDatabase(databasePath);
    try {
      expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(database.pragma('busy_timeout', { simple: true })).toBe(5000);
      expect(database.pragma('synchronous', { simple: true })).toBe(1);
    } finally {
      database.close();
    }
  });

  it('closes the handle when store initialization fails so the file is not locked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-sqlite-init-'));
    directories.push(directory);
    const databasePath = join(directory, 'init-failure.db');

    const database = openSqliteDatabase(databasePath);
    expect(() =>
      initializeSqliteDatabase(database, () => {
        throw new Error('migration failed');
      }),
    ).toThrow('migration failed');

    await expect(rm(databasePath, { force: true })).resolves.toBeUndefined();
  });
});
