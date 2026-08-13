import { randomUUID } from 'node:crypto';

export type SupportTicketStatus = 'open' | 'closed';

export interface SupportTicket {
  readonly id: string;
  readonly guildId: string;
  readonly requesterId: string;
  readonly channelId: string;
  readonly subject: string;
  readonly status: SupportTicketStatus;
  readonly createdAt: Date;
  readonly closedAt?: Date;
}

export interface SupportTicketRepository {
  create(ticket: SupportTicket): Promise<void>;
  get(guildId: string, id: string): Promise<SupportTicket | undefined>;
  listOpenForRequester(guildId: string, requesterId: string): Promise<readonly SupportTicket[]>;
  listOpen(guildId: string): Promise<readonly SupportTicket[]>;
  close(guildId: string, id: string, closedAt: Date): Promise<boolean>;
}

export class InMemorySupportTicketRepository implements SupportTicketRepository {
  private readonly tickets = new Map<string, SupportTicket>();
  async create(ticket: SupportTicket): Promise<void> { this.tickets.set(`${ticket.guildId}:${ticket.id}`, ticket); }
  async get(guildId: string, id: string): Promise<SupportTicket | undefined> { return this.tickets.get(`${guildId}:${id}`); }
  async listOpenForRequester(guildId: string, requesterId: string): Promise<readonly SupportTicket[]> { return [...this.tickets.values()].filter((t) => t.guildId === guildId && t.requesterId === requesterId && t.status === 'open'); }
  async listOpen(guildId: string): Promise<readonly SupportTicket[]> { return [...this.tickets.values()].filter((t) => t.guildId === guildId && t.status === 'open'); }
  async close(guildId: string, id: string, closedAt: Date): Promise<boolean> {
    const ticket = this.tickets.get(`${guildId}:${id}`);
    if (!ticket || ticket.status === 'closed') return false;
    this.tickets.set(`${guildId}:${id}`, { ...ticket, status: 'closed', closedAt });
    return true;
  }
}

export interface SupportTicketPolicy {
  readonly enabled: boolean;
  readonly channelId: string;
  readonly adminRoleIds: ReadonlySet<string>;
  readonly maxOpenPerRequester?: number;
  readonly maxSubjectChars?: number;
}

export type SupportTicketResult =
  | { readonly ok: true; readonly ticket: SupportTicket }
  | { readonly ok: false; readonly reason: 'disabled' | 'invalid' | 'limit' | 'not-found' | 'forbidden' };

export class SupportTicketService {
  constructor(private readonly repository: SupportTicketRepository, private readonly policy: SupportTicketPolicy) {}

  async create(input: { guildId: string; requesterId: string; channelId: string; subject: string; now?: Date }): Promise<SupportTicketResult> {
    if (!this.policy.enabled || this.policy.channelId === '' || input.channelId !== this.policy.channelId) return { ok: false, reason: 'disabled' };
    const subject = input.subject.trim();
    if (subject.length < 1 || subject.length > (this.policy.maxSubjectChars ?? 240)) return { ok: false, reason: 'invalid' };
    const open = await this.repository.listOpenForRequester(input.guildId, input.requesterId);
    if (open.length >= (this.policy.maxOpenPerRequester ?? 1)) return { ok: false, reason: 'limit' };
    const ticket: SupportTicket = { id: randomUUID(), guildId: input.guildId, requesterId: input.requesterId, channelId: input.channelId, subject, status: 'open', createdAt: input.now ?? new Date() };
    await this.repository.create(ticket);
    return { ok: true, ticket };
  }

  async close(input: { guildId: string; ticketId: string; actorId: string; actorRoleIds: ReadonlySet<string>; now?: Date }): Promise<SupportTicketResult> {
    const ticket = await this.repository.get(input.guildId, input.ticketId);
    if (!ticket) return { ok: false, reason: 'not-found' };
    const isAdmin = [...input.actorRoleIds].some((role) => this.policy.adminRoleIds.has(role));
    if (ticket.requesterId !== input.actorId && !isAdmin) return { ok: false, reason: 'forbidden' };
    if (ticket.status === 'closed') return { ok: true, ticket };
    await this.repository.close(input.guildId, ticket.id, input.now ?? new Date());
    return { ok: true, ticket: { ...ticket, status: 'closed', closedAt: input.now ?? new Date() } };
  }
}
