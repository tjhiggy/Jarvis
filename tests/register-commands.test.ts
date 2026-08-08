import { describe, expect, it } from 'vitest';
import { registerCommands } from '../scripts/register-commands.js';
import type { FaqCatalog } from '../src/faq/faq-catalog.js';

describe('registerCommands', () => {
  it('bulk-overwrites the configured guild command set when polls are disabled', async () => {
    const calls: Array<{
      route: string;
      options: Readonly<{ body: readonly unknown[] }>;
    }> = [];
    const tokens: string[] = [];
    const events: string[] = [];
    let environmentLoads = 0;

    await registerCommands({
      env: {
        DISCORD_TOKEN: 'discord-token',
        DISCORD_CLIENT_ID: 'client-id',
        DISCORD_GUILD_ID: 'guild-id',
        MAX_INPUT_CHARS: '123',
      },
      loadEnvironment: () => {
        environmentLoads += 1;
      },
      loadFaqCatalog: async (path) => {
        events.push(`load:${path}`);
        return faqCatalog();
      },
      createClient: (token) => {
        tokens.push(token);
        return {
          put: async (route, options) => {
            events.push('put');
            calls.push({ route, options });
          },
        };
      },
    });

    expect(environmentLoads).toBe(1);
    expect(tokens).toEqual(['discord-token']);
    expect(events).toEqual(['load:./config/faq.json', 'put']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.route).toBe(
      '/applications/client-id/guilds/guild-id/commands',
    );
    expect(
      calls[0]?.options.body.map((definition) =>
        typeof definition === 'object' &&
        definition !== null &&
        'name' in definition
          ? definition.name
          : undefined,
      ),
    ).toEqual([
      'ask',
      'search',
      'forget',
      'help',
      'status',
      'faq',
      'reminder',
      'fantasy',
      'introduce',
      'introduction',
      'suggest',
      'suggestion',
      'event',
      'recap',
      'trivia',
    ]);
    expect(JSON.stringify(calls[0]?.options.body)).not.toContain(
      'POLL_VOTER_SECRET',
    );
  });

  it('registers poll commands without placing poll credentials in the payload', async () => {
    const calls: Array<{
      route: string;
      options: Readonly<{ body: readonly unknown[] }>;
    }> = [];
    const voterSecret = '0123456789abcdef0123456789abcdef';
    const administratorIds = '12345678901234567,98765432109876543';

    await registerCommands({
      env: {
        DISCORD_TOKEN: 'discord-token',
        DISCORD_CLIENT_ID: 'client-id',
        DISCORD_GUILD_ID: 'guild-id',
        POLL_ADMIN_USER_IDS: administratorIds,
        POLL_VOTER_SECRET: voterSecret,
      },
      loadEnvironment: () => undefined,
      loadFaqCatalog: async () => faqCatalog(),
      createClient: () => ({
        put: async (route, options) => {
          calls.push({ route, options });
        },
      }),
    });

    expect(
      calls[0]?.options.body.map((definition) =>
        typeof definition === 'object' &&
        definition !== null &&
        'name' in definition
          ? definition.name
          : undefined,
      ),
    ).toEqual([
      'ask',
      'search',
      'forget',
      'help',
      'status',
      'faq',
      'reminder',
      'fantasy',
      'poll',
      'poll-close',
      'introduce',
      'introduction',
      'suggest',
      'suggestion',
      'event',
      'recap',
      'trivia',
    ]);
    const payload = JSON.stringify(calls[0]?.options.body);
    expect(payload).not.toContain(voterSecret);
    expect(payload).not.toContain(administratorIds);
  });
});

function faqCatalog(): FaqCatalog {
  const entry = {
    id: 'capabilities',
    label: 'Jarvis capabilities',
    question: 'What can Jarvis do?',
    answer: 'Jarvis answers approved questions.',
  };

  return {
    entries: [entry],
    get: (id) => (id === entry.id ? entry : undefined),
  };
}
