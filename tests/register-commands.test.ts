import { describe, expect, it } from 'vitest';
import { registerCommands } from '../scripts/register-commands.js';

describe('registerCommands', () => {
  it('bulk-overwrites only the configured guild command route without OpenAI configuration', async () => {
    const calls: Array<{
      route: string;
      options: Readonly<{ body: readonly unknown[] }>;
    }> = [];
    const tokens: string[] = [];
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
      createClient: (token) => {
        tokens.push(token);
        return {
          put: async (route, options) => {
            calls.push({ route, options });
          },
        };
      },
    });

    expect(environmentLoads).toBe(1);
    expect(tokens).toEqual(['discord-token']);
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
    ).toEqual(['ask', 'forget', 'help', 'status']);
  });
});
