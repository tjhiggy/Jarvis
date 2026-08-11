import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  ApprovedKnowledgeCatalog,
  KnowledgeResult,
} from './approved-knowledge.js';
import { rankKnowledgeResults } from './approved-knowledge.js';

export interface KnowledgeAdminEntry {
  readonly id: string;
  readonly title: string;
  readonly approved: boolean;
  readonly active: boolean;
}

/** Durable per-server approval state for entries from the configured catalog. */
export class SQLiteKnowledgeApprovalStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:')
      mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_approvals (
        guild_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        approved INTEGER NOT NULL CHECK (approved IN (0, 1)),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, entry_id)
      )
    `);
  }

  async list(
    guildId: string,
    catalog: ApprovedKnowledgeCatalog,
  ): Promise<readonly KnowledgeResult[]> {
    const overrides = new Map<string, boolean>(
      (
        this.database
          .prepare(
            'SELECT entry_id, approved FROM knowledge_approvals WHERE guild_id = ?',
          )
          .all(guildId) as { entry_id: string; approved: number }[]
      ).map((row) => [row.entry_id, row.approved === 1]),
    );
    const now = Date.now();
    return catalog.entries
      .filter(
        (entry) =>
          (overrides.get(entry.id) ?? entry.approved) &&
          (entry.retentionDays === undefined ||
            now - Date.parse(entry.updatedAt) <=
              entry.retentionDays * 86_400_000),
      )
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        content: entry.content,
        source: entry.source,
        updatedAt: entry.updatedAt,
      }));
  }

  /** Return catalog state for administrators without exposing source content. */
  async listForAdmin(
    guildId: string,
    catalog: ApprovedKnowledgeCatalog,
  ): Promise<readonly KnowledgeAdminEntry[]> {
    const overrides = new Map<string, boolean>(
      (
        this.database
          .prepare(
            'SELECT entry_id, approved FROM knowledge_approvals WHERE guild_id = ?',
          )
          .all(guildId) as { entry_id: string; approved: number }[]
      ).map((row) => [row.entry_id, row.approved === 1]),
    );
    const now = Date.now();
    return catalog.entries.map((entry) => {
      const approved = overrides.get(entry.id) ?? entry.approved;
      const active =
        approved &&
        (entry.retentionDays === undefined ||
          now - Date.parse(entry.updatedAt) <=
            entry.retentionDays * 86_400_000);
      return { id: entry.id, title: entry.title, approved, active };
    });
  }

  async approve(
    guildId: string,
    entryId: string,
    catalog: ApprovedKnowledgeCatalog,
  ): Promise<boolean> {
    const id = entryId.trim().toLowerCase();
    if (!catalog.entries.some((entry) => entry.id === id)) return false;
    this.database
      .prepare(
        `INSERT INTO knowledge_approvals (guild_id, entry_id, approved, updated_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(guild_id, entry_id) DO UPDATE SET approved = 1, updated_at = excluded.updated_at`,
      )
      .run(guildId, id, Date.now());
    return true;
  }

  async revoke(
    guildId: string,
    entryId: string,
    catalog: ApprovedKnowledgeCatalog,
  ): Promise<boolean> {
    const id = entryId.trim().toLowerCase();
    if (!catalog.entries.some((entry) => entry.id === id)) return false;
    this.database
      .prepare(
        `INSERT INTO knowledge_approvals (guild_id, entry_id, approved, updated_at) VALUES (?, ?, 0, ?)
      ON CONFLICT(guild_id, entry_id) DO UPDATE SET approved = 0, updated_at = excluded.updated_at`,
      )
      .run(guildId, id, Date.now());
    return true;
  }

  async search(
    guildId: string,
    query: string,
    catalog: ApprovedKnowledgeCatalog,
  ): Promise<readonly KnowledgeResult[]> {
    return rankKnowledgeResults(await this.list(guildId, catalog), query);
  }

  close(): void {
    this.database.close();
  }
}
