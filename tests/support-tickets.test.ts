import { describe, expect, it } from 'vitest';
import {
  InMemorySupportTicketRepository,
  SupportTicketService,
} from '../src/support/tickets.js';

const service = (overrides = {}) =>
  new SupportTicketService(new InMemorySupportTicketRepository(), {
    enabled: true,
    channelId: 'support',
    adminRoleIds: new Set(['admin']),
    ...overrides,
  });

describe('support tickets', () => {
  it('creates one private ticket in the configured support channel', async () => {
    const result = await service().create({
      guildId: 'g',
      requesterId: 'u',
      channelId: 'support',
      subject: 'Cannot access commands',
    });
    expect(result.ok).toBe(true);
  });
  it('rejects tickets outside the configured channel and limits duplicates', async () => {
    const s = service();
    const outside = await s.create({
      guildId: 'g',
      requesterId: 'u',
      channelId: 'general',
      subject: 'x',
    });
    expect(outside.ok ? 'ok' : outside.reason).toBe('disabled');
    await s.create({
      guildId: 'g',
      requesterId: 'u',
      channelId: 'support',
      subject: 'x',
    });
    const duplicate = await s.create({
      guildId: 'g',
      requesterId: 'u',
      channelId: 'support',
      subject: 'y',
    });
    expect(duplicate.ok ? 'ok' : duplicate.reason).toBe('limit');
  });
  it('allows requester or configured admin to close, not other members', async () => {
    const s = service();
    const created = await s.create({
      guildId: 'g',
      requesterId: 'u',
      channelId: 'support',
      subject: 'x',
    });
    if (!created.ok) throw new Error('expected ticket');
    const forbidden = await s.close({
      guildId: 'g',
      ticketId: created.ticket.id,
      actorId: 'other',
      actorRoleIds: new Set(),
    });
    expect(forbidden.ok ? 'ok' : forbidden.reason).toBe('forbidden');
    expect(
      (
        await s.close({
          guildId: 'g',
          ticketId: created.ticket.id,
          actorId: 'admin',
          actorRoleIds: new Set(['admin']),
        })
      ).ok,
    ).toBe(true);
  });
});
