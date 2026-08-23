import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Open a SQLite database with the shared Jarvis connection settings.
 * Creates parent directories as needed. If pragma setup fails, the handle is
 * closed before the error is rethrown so the file is not left locked.
 */
export function openSqliteDatabase(databasePath: string): Database.Database {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new Database(databasePath);
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    database.pragma('synchronous = NORMAL');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/**
 * Run store-specific initialization against an already-opened connection.
 * Closes the handle if initialization throws so callers cannot leak a lock.
 */
export function initializeSqliteDatabase(
  database: Database.Database,
  initialize: (database: Database.Database) => void,
): void {
  try {
    initialize(database);
  } catch (error) {
    database.close();
    throw error;
  }
}
