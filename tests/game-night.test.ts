import { describe, expect, it } from 'vitest';
import { handleGameNightCommand } from '../src/commands/game-night.js';

describe('game night command', () => {
  it('schedules a low-friction game night with defaults', async () => {
    let input: any;
    const interaction: any = { guildId: 'g', user: { id: 'u' }, member: { roles: { cache: { has: (id: string) => id === 'admin' } } }, options: { getSubcommand: () => 'create', getString: (name: string) => ({ game: 'Fortnite', start: '2026-08-10 20:00' } as any)[name] ?? null }, reply: async (value: any) => { interaction.replyValue = value; } };
    await handleGameNightCommand(interaction, { enabled: true, channelId: 'events', adminRoleIds: new Set(['admin']), service: { create: async (value: any) => { input = value; return { id: 'gn-1' }; } } as any });
    expect(input).toMatchObject({ title: 'Game Night: Fortnite', timezone: 'America/New_York', capacity: 20 });
  });
});
