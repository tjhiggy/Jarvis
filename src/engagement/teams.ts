import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export interface Team {
  readonly guildId: string;
  readonly id: string;
  readonly name: string;
  readonly ownerUserId: string;
  readonly createdAt: Date;
  readonly memberCount: number;
}

export interface TeamStore {
  create(guildId: string, name: string, ownerUserId: string, now?: Date): Promise<Team>;
  join(guildId: string, teamId: string, userId: string, now?: Date): Promise<Team>;
  leave(guildId: string, teamId: string, userId: string): Promise<boolean>;
  list(guildId: string): Promise<readonly Team[]>;
  close(): Promise<void>;
}

const MAX_NAME = 80;
const MAX_TEAMS = 100;
const MAX_MEMBERS = 50;

const normalize = (name: string): string => name.trim().replace(/\s+/g, ' ');
const validate = (guildId: string, value: string, field: string): void => {
  if (!guildId || !value) throw new Error(`${field} is required.`);
};

export class SQLiteTeamStore implements TeamStore {
  private readonly database: Database.Database;
  private closed = false;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma('foreign_keys = ON');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS engagement_teams (
        guild_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
        owner_user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, id), UNIQUE (guild_id, name)
      );
      CREATE TABLE IF NOT EXISTS engagement_team_members (
        guild_id TEXT NOT NULL, team_id TEXT NOT NULL, user_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, team_id, user_id),
        FOREIGN KEY (guild_id, team_id) REFERENCES engagement_teams(guild_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS engagement_team_members_lookup ON engagement_team_members(guild_id, team_id);
    `);
  }

  async create(guildId: string, rawName: string, ownerUserId: string, now = new Date()): Promise<Team> {
    this.ensureOpen();
    validate(guildId, ownerUserId, 'Owner');
    const name = normalize(rawName);
    if (!name || name.length > MAX_NAME) throw new Error(`Team name must be between 1 and ${MAX_NAME} characters.`);
    const count = (this.database.prepare('SELECT COUNT(*) AS count FROM engagement_teams WHERE guild_id = ?').get(guildId) as { count: number }).count;
    if (count >= MAX_TEAMS) throw new Error(`This server has reached the ${MAX_TEAMS}-team limit.`);
    const id = randomUUID().slice(0, 12);
    try {
      this.database.transaction(() => {
        this.database.prepare('INSERT INTO engagement_teams (guild_id,id,name,owner_user_id,created_at) VALUES (?,?,?,?,?)').run(guildId, id, name, ownerUserId, now.getTime());
        this.database.prepare('INSERT INTO engagement_team_members (guild_id,team_id,user_id,joined_at) VALUES (?,?,?,?)').run(guildId, id, ownerUserId, now.getTime());
      })();
    } catch { throw new Error('A team with that name already exists.'); }
    return { guildId, id, name, ownerUserId, createdAt: now, memberCount: 1 };
  }

  async join(guildId: string, teamId: string, userId: string, now = new Date()): Promise<Team> {
    this.ensureOpen(); validate(guildId, teamId, 'Team'); validate(guildId, userId, 'User');
    const team = this.row(guildId, teamId); if (!team) throw new Error('That team was not found.');
    const count = (this.database.prepare('SELECT COUNT(*) AS count FROM engagement_team_members WHERE guild_id = ? AND team_id = ?').get(guildId, teamId) as { count: number }).count;
    if (count >= MAX_MEMBERS) throw new Error(`That team has reached the ${MAX_MEMBERS}-member limit.`);
    this.database.prepare('INSERT OR IGNORE INTO engagement_team_members (guild_id,team_id,user_id,joined_at) VALUES (?,?,?,?)').run(guildId, teamId, userId, now.getTime());
    return this.toTeam(team);
  }

  async leave(guildId: string, teamId: string, userId: string): Promise<boolean> {
    this.ensureOpen(); validate(guildId, teamId, 'Team'); validate(guildId, userId, 'User');
    return this.database.prepare('DELETE FROM engagement_team_members WHERE guild_id = ? AND team_id = ? AND user_id = ?').run(guildId, teamId, userId).changes > 0;
  }

  async list(guildId: string): Promise<readonly Team[]> {
    this.ensureOpen(); validate(guildId, guildId, 'Server');
    return (this.database.prepare('SELECT t.guild_id,t.id,t.name,t.owner_user_id,t.created_at,COUNT(m.user_id) AS member_count FROM engagement_teams t LEFT JOIN engagement_team_members m ON m.guild_id=t.guild_id AND m.team_id=t.id WHERE t.guild_id = ? GROUP BY t.guild_id,t.id ORDER BY t.created_at ASC').all(guildId) as Array<TeamRow>).map((row) => this.toTeam(row));
  }

  async close(): Promise<void> { if (!this.closed) { this.database.close(); this.closed = true; } }
  private row(guildId: string, id: string): TeamRow | undefined { return this.database.prepare('SELECT t.guild_id,t.id,t.name,t.owner_user_id,t.created_at,COUNT(m.user_id) AS member_count FROM engagement_teams t LEFT JOIN engagement_team_members m ON m.guild_id=t.guild_id AND m.team_id=t.id WHERE t.guild_id = ? AND t.id = ? GROUP BY t.guild_id,t.id').get(guildId, id) as TeamRow | undefined; }
  private toTeam(row: TeamRow): Team { return { guildId: row.guild_id, id: row.id, name: row.name, ownerUserId: row.owner_user_id, createdAt: new Date(row.created_at), memberCount: row.member_count }; }
  private ensureOpen(): void { if (this.closed) throw new Error('Team store is closed.'); }
}

interface TeamRow { guild_id: string; id: string; name: string; owner_user_id: string; created_at: number; member_count: number; }
