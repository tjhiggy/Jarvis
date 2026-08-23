import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  ConversationMessage,
  ConversationStore,
  NewConversationMessage,
} from './conversation-store.js';

interface ConversationRow {
  id: number;
  guild_id: string;
  conversation_id: string;
  user_id: string;
  role: ConversationMessage['role'];
  content: string;
  created_at: number;
  openai_response_id: string | null;
}

const schemaVersion = 1;

export class SQLiteConversationStore implements ConversationStore {
  private readonly database: Database.Database;
  private readonly appendStatement: Database.Statement;
  private readonly trimStatement: Database.Statement;
  private readonly appendTransaction: (message: NewConversationMessage) => void;
  private readonly getRecentStatement: Database.Statement;
  private readonly clearStatement: Database.Statement;
  private readonly cleanupStatement: Database.Statement;
  private readonly healthCheckStatement: Database.Statement;
  private closed = false;

  constructor(databasePath: string, maxStoredMessages = 10_000) {
    if (!Number.isSafeInteger(maxStoredMessages) || maxStoredMessages < 1) {
      throw new RangeError(
        'Stored message limit must be a positive safe integer.',
      );
    }

    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    try {
      this.configure();
      this.migrate();
    } catch (error) {
      this.database.close();
      throw error;
    }

    this.appendStatement = this.database.prepare(`
      INSERT INTO conversation_messages (
        guild_id,
        conversation_id,
        user_id,
        role,
        content,
        created_at,
        openai_response_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.trimStatement = this.database.prepare(`
      DELETE FROM conversation_messages
      WHERE id IN (
        SELECT id
        FROM conversation_messages
        ORDER BY id ASC
        LIMIT MAX(
          (SELECT COUNT(*) FROM conversation_messages) - ?,
          0
        )
      )
    `);
    this.appendTransaction = this.database.transaction(
      (message: NewConversationMessage) => {
        this.appendStatement.run(
          message.guildId,
          message.conversationId,
          message.userId,
          message.role,
          message.content,
          message.timestamp.getTime(),
          message.openaiResponseId ?? null,
        );
        this.trimStatement.run(maxStoredMessages);
      },
    );
    this.getRecentStatement = this.database.prepare(`
      SELECT
        id,
        guild_id,
        conversation_id,
        user_id,
        role,
        content,
        created_at,
        openai_response_id
      FROM (
        SELECT
          id,
          guild_id,
          conversation_id,
          user_id,
          role,
          content,
          created_at,
          openai_response_id
        FROM conversation_messages
        WHERE guild_id = ? AND conversation_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      ) AS newest_messages
      ORDER BY created_at ASC, id ASC
    `);
    this.clearStatement = this.database.prepare(`
      DELETE FROM conversation_messages
      WHERE guild_id = ? AND conversation_id = ?
    `);
    this.cleanupStatement = this.database.prepare(`
      DELETE FROM conversation_messages
      WHERE created_at < ?
    `);
    this.healthCheckStatement = this.database.prepare('SELECT 1');
  }

  async append(message: NewConversationMessage): Promise<void> {
    this.ensureOpen();
    this.appendTransaction(message);
  }

  async getRecent(
    guildId: string,
    conversationId: string,
    limit: number,
  ): Promise<ConversationMessage[]> {
    this.ensureOpen();
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError(
        'History limit must be a non-negative safe integer.',
      );
    }

    const rows = this.getRecentStatement.all(
      guildId,
      conversationId,
      limit,
    ) as ConversationRow[];

    return rows.map((row) => toConversationMessage(row));
  }

  async clear(guildId: string, conversationId: string): Promise<number> {
    this.ensureOpen();
    return this.clearStatement.run(guildId, conversationId).changes;
  }

  async cleanup(olderThan: Date): Promise<number> {
    this.ensureOpen();
    return this.cleanupStatement.run(olderThan.getTime()).changes;
  }

  async healthCheck(): Promise<boolean> {
    if (this.closed) {
      return false;
    }

    try {
      this.healthCheckStatement.get();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }

  private configure(): void {
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.database.pragma('synchronous = NORMAL');
  }

  private migrate(): void {
    const currentVersion = this.database.pragma('user_version', {
      simple: true,
    }) as number;

    if (currentVersion > schemaVersion) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than supported version ${schemaVersion}.`,
      );
    }

    if (currentVersion === schemaVersion) {
      return;
    }

    this.database.transaction(() => {
      this.database
        .prepare(
          `
        CREATE TABLE IF NOT EXISTS conversation_messages (
          id INTEGER PRIMARY KEY,
          guild_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          openai_response_id TEXT
        )
      `,
        )
        .run();
      this.database
        .prepare(
          `
          CREATE INDEX IF NOT EXISTS conversation_messages_guild_conversation_created_at_id
          ON conversation_messages (guild_id, conversation_id, created_at, id);
        `,
        )
        .run();
      this.database.pragma('user_version = 1');
    })();
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('Conversation store is closed.');
    }
  }
}

function toConversationMessage(row: ConversationRow): ConversationMessage {
  return {
    id: row.id,
    guildId: row.guild_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    timestamp: new Date(row.created_at),
    ...(row.openai_response_id === null
      ? {}
      : { openaiResponseId: row.openai_response_id }),
  };
}
