import { describe, expect, it } from 'vitest';
import { handleEngagementCommand } from '../src/commands/engagement.js';

describe('engagement controls', () => {
  it('allows configured admins to pause engagement and records the acting admin', async () => {
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    const pauses: unknown[][] = [];
    await handleEngagementCommand(
      interaction(replies, 'pause', ['admin-role']),
      {
        enabled: true,
        adminRoleIds: new Set(['admin-role']),
        repository: {
          setEngagementPaused: async (...value) => {
            pauses.push(value);
          },
          engagementPaused: async () => false,
          healthCheck: async () => true,
          statusCounts: async () => ({
            introductions: 0,
            suggestions: 0,
            events: 0,
            rsvps: 0,
            triviaRounds: 0,
          }),
          deleteOwnerData: async () => ({ completed: 0, pending: 0 }),
        },
      },
    );
    expect(pauses).toHaveLength(1);
    expect(pauses[0]?.slice(0, 3)).toEqual(['guild-1', true, 'admin-1']);
    expect(replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/paused/i),
        ephemeral: true,
      }),
    ]);
  });

  it('denies a non-admin before status diagnostics run', async () => {
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    let healthChecks = 0;
    await handleEngagementCommand(interaction(replies, 'status'), {
      enabled: true,
      adminRoleIds: new Set(['admin-role']),
      repository: {
        setEngagementPaused: async () => undefined,
        engagementPaused: async () => false,
        healthCheck: async () => {
          healthChecks += 1;
          return true;
        },
        statusCounts: async () => ({
          introductions: 0,
          suggestions: 0,
          events: 0,
          rsvps: 0,
          triviaRounds: 0,
        }),
        deleteOwnerData: async () => ({ completed: 0, pending: 0 }),
      },
    });
    expect(healthChecks).toBe(0);
    expect(replies[0]).toEqual(
      expect.objectContaining({
        content: expect.stringMatching(/restricted/i),
        ephemeral: true,
      }),
    );
  });

  it('reports completed and still-pending deletion work truthfully', async () => {
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    await handleEngagementCommand(interaction(replies, 'delete'), {
      enabled: true,
      adminRoleIds: new Set(['admin-role']),
      repository: {
        setEngagementPaused: async () => undefined,
        engagementPaused: async () => false,
        healthCheck: async () => true,
        statusCounts: async () => ({
          introductions: 0,
          suggestions: 0,
          events: 0,
          rsvps: 0,
          triviaRounds: 0,
        }),
        deleteOwnerData: async () => ({ completed: 2, pending: 1 }),
      },
    });
    expect(replies[0]?.content).toMatch(/removed 2/i);
    expect(replies[0]?.content).toMatch(/1.*queued|queued.*1/i);
    expect(replies[0]?.content).not.toMatch(/^Removed 3/i);
  });

  it('allows an administrator to enable and inspect the profiles feature', async () => {
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    const changes: unknown[][] = [];
    let enabled = false;
    const featureFlags = {
      isEnabled: async (_guildId: string, name: string) =>
        name === 'profiles' && enabled,
      set: async (...values: [string, 'profiles', boolean]) => {
        changes.push(values);
        enabled = values[2];
      },
    };
    const dependencies = {
      enabled: true,
      adminRoleIds: new Set(['admin-role']),
      featureFlags,
      repository: repository(),
    };

    await handleEngagementCommand(
      interaction(replies, 'feature', ['admin-role'], {
        action: 'enable',
        name: 'profiles',
      }),
      dependencies,
    );
    await handleEngagementCommand(
      interaction(replies, 'feature', ['admin-role'], {
        action: 'status',
        name: 'profiles',
      }),
      dependencies,
    );

    expect(changes).toEqual([['guild-1', 'profiles', true]]);
    expect(replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/enabled/i),
        ephemeral: true,
      }),
      expect.objectContaining({
        content: expect.stringMatching(/enabled/i),
        ephemeral: true,
      }),
    ]);
  });

  it('denies profile feature control to non-administrators', async () => {
    const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
    let changes = 0;
    await handleEngagementCommand(
      interaction(replies, 'feature', [], {
        action: 'enable',
        name: 'profiles',
      }),
      {
        enabled: true,
        adminRoleIds: new Set(['admin-role']),
        featureFlags: {
          isEnabled: async () => false,
          set: async () => {
            changes += 1;
          },
        },
        repository: repository(),
      },
    );
    expect(changes).toBe(0);
    expect(replies[0]).toEqual(
      expect.objectContaining({
        content: expect.stringMatching(/restricted/i),
        ephemeral: true,
      }),
    );
  });
});

function repository() {
  return {
    setEngagementPaused: async () => undefined,
    engagementPaused: async () => false,
    healthCheck: async () => true,
    statusCounts: async () => ({
      introductions: 0,
      suggestions: 0,
      events: 0,
      rsvps: 0,
      triviaRounds: 0,
    }),
    deleteOwnerData: async () => ({ completed: 0, pending: 0 }),
  };
}

function interaction(
  replies: Array<{ content?: string; ephemeral?: boolean }>,
  subcommand: string,
  roles: readonly string[] = [],
  strings: Readonly<Record<string, string>> = {},
) {
  return {
    guildId: 'guild-1',
    user: { id: 'admin-1' },
    member: {
      roles: { cache: { has: (role: string) => roles.includes(role) } },
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => strings[name] ?? null,
    },
    reply: async (payload: { content?: string; ephemeral?: boolean }) => {
      replies.push(payload);
    },
  };
}
