import { describe, expect, it } from 'vitest';
import { searchRetainedConversation } from '../src/commands/server-search.js';

describe('retained conversation search', () => {
  it('ranks multi-token matches and includes bounded source times', () => {
    const results = searchRetainedConversation(
      [
        message(1, 'The crew scheduled a Fortnite RSVP.', 'user'),
        message(2, 'RSVP responses close Friday.', 'assistant'),
        message(3, 'Fortnite patch notes arrived.', 'assistant'),
      ],
      'Fortnite RSVP',
    );

    expect(results).toHaveLength(3);
    expect(results[0]).toContain('2026-08-11T12:00:01.000Z');
    expect(results.join('\n')).toContain('Fortnite');
  });

  it('neutralizes mentions and returns at most five matches', () => {
    const results = searchRetainedConversation(
      Array.from({ length: 8 }, (_, index) =>
        message(index, `crew update ${index} @everyone <@&123>`, 'user'),
      ),
      'crew update',
    );

    expect(results).toHaveLength(5);
    expect(results.join('\n')).not.toContain('@everyone');
    expect(results.join('\n')).not.toContain('<@&123>');
  });

  it('abstains when retained conversation has no relevant match', () => {
    expect(
      searchRetainedConversation([message(1, 'Game night', 'user')], 'taxes'),
    ).toEqual([]);
  });
});

const message = (id: number, content: string, role: 'user' | 'assistant') => ({
  id,
  guildId: 'server-1',
  conversationId: 'channel-1',
  userId: 'crew-1',
  role,
  content,
  timestamp: new Date(`2026-08-11T12:00:${String(id).padStart(2, '0')}.000Z`),
});
