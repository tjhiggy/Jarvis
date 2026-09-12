import { describe, expect, it, vi } from 'vitest';
import { handleNotificationCommand } from '../src/commands/notifications.js';

const safeMentions = { parse: [], repliedUser: false };

describe('handleNotificationCommand', () => {
  it('shows disabled defaults for each crew-controlled category privately', async () => {
    const request = interaction('status');
    const store = preferenceStore();

    await handleNotificationCommand(request.value, { store });

    expect(request.reply).toHaveBeenCalledWith({
      content:
        'Notification preferences for this MuthaShip server:\n• Event reminders: disabled\n• Birthday mentions: disabled',
      ephemeral: true,
      allowedMentions: safeMentions,
    });
  });

  it('persists the invoking crew member enable choice privately', async () => {
    const request = interaction('enable', 'event_reminder');
    const store = preferenceStore();
    const now = new Date('2026-08-11T12:00:00.000Z');

    await handleNotificationCommand(request.value, { store, now: () => now });

    expect(store.setMemberPreference).toHaveBeenCalledWith({
      serverId: 'server-1',
      userId: 'crew-member-1',
      category: 'event_reminder',
      enabled: true,
      updatedAt: now,
    });
    expect(request.reply).toHaveBeenCalledWith({
      content:
        'Event reminders are now enabled for you on this MuthaShip server.',
      ephemeral: true,
      allowedMentions: safeMentions,
    });
  });

  it('rejects a public RSS category without persisting a crew preference', async () => {
    const request = interaction('disable', 'rss');
    const store = preferenceStore();

    await handleNotificationCommand(request.value, { store });

    expect(store.setMemberPreference).not.toHaveBeenCalled();
    expect(request.reply).toHaveBeenCalledWith({
      content:
        'That category is a public channel broadcast, so a personal toggle would not hide it. Ask a MuthaShip administrator to pause or move the broadcast instead.',
      ephemeral: true,
      allowedMentions: safeMentions,
    });
  });

  it('rejects bot users and reports unavailable storage privately', async () => {
    const bot = interaction('status', undefined, true);
    await handleNotificationCommand(bot.value, { store: preferenceStore() });
    expect(bot.reply).toHaveBeenCalledWith({
      content: 'Notification preferences are not available for bot users.',
      ephemeral: true,
      allowedMentions: safeMentions,
    });

    const unavailable = interaction('status');
    await handleNotificationCommand(unavailable.value, {});
    expect(unavailable.reply).toHaveBeenCalledWith({
      content: 'Notification preferences are temporarily unavailable.',
      ephemeral: true,
      allowedMentions: safeMentions,
    });
  });

  it('stays private in a DM or blank guild and does not persist', async () => {
    const store = preferenceStore();
    for (const guildId of [null, '   ']) {
      const request = interaction('enable', 'event_reminder');
      request.value.guildId = guildId;
      await handleNotificationCommand(request.value, { store });
      expect(store.setMemberPreference).not.toHaveBeenCalled();
      expect(request.reply).toHaveBeenCalledWith({
        content:
          'Notification preferences are available only in a MuthaShip server.',
        ephemeral: true,
        allowedMentions: safeMentions,
      });
    }
  });

  it('rejects an invalid category or action without persisting', async () => {
    const store = preferenceStore();
    const unknown = interaction('enable', 'trivia');
    await handleNotificationCommand(unknown.value, { store });
    expect(store.setMemberPreference).not.toHaveBeenCalled();
    expect(unknown.reply).toHaveBeenCalledWith({
      content: 'Choose a valid notification category.',
      ephemeral: true,
      allowedMentions: safeMentions,
    });

    const publicCategory = interaction('enable', 'proactive');
    await handleNotificationCommand(publicCategory.value, { store });
    expect(store.setMemberPreference).not.toHaveBeenCalled();
    expect(publicCategory.reply).toHaveBeenCalledWith({
      content:
        'That category is a public channel broadcast, so a personal toggle would not hide it. Ask a MuthaShip administrator to pause or move the broadcast instead.',
      ephemeral: true,
      allowedMentions: safeMentions,
    });

    const unknownAction = interaction('toggle', 'birthday');
    await handleNotificationCommand(unknownAction.value, { store });
    expect(store.setMemberPreference).not.toHaveBeenCalled();
    expect(unknownAction.reply).toHaveBeenCalledWith({
      content: 'Choose a valid notification action.',
      ephemeral: true,
      allowedMentions: safeMentions,
    });
  });

  it('persists a birthday disable choice privately', async () => {
    const request = interaction('disable', 'birthday');
    const store = preferenceStore();
    const now = new Date('2026-09-12T10:00:00.000Z');

    await handleNotificationCommand(request.value, { store, now: () => now });

    expect(store.setMemberPreference).toHaveBeenCalledWith({
      serverId: 'server-1',
      userId: 'crew-member-1',
      category: 'birthday',
      enabled: false,
      updatedAt: now,
    });
    expect(request.reply).toHaveBeenCalledWith({
      content:
        'Birthday mentions are now disabled for you on this MuthaShip server.',
      ephemeral: true,
      allowedMentions: safeMentions,
    });
  });

  it('returns a generic private recovery message when storage fails', async () => {
    const request = interaction('disable', 'birthday');
    const store = preferenceStore({
      setMemberPreference: vi.fn().mockRejectedValue(new Error('secret')),
    });

    await handleNotificationCommand(request.value, { store });

    expect(request.reply).toHaveBeenCalledWith({
      content:
        'Notification preferences could not be updated. Please try again later.',
      ephemeral: true,
      allowedMentions: safeMentions,
    });
  });
});

function interaction(action: string, category?: string, bot = false) {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    value: {
      guildId: 'server-1' as string | null,
      user: { id: 'crew-member-1', bot },
      options: {
        getSubcommand: () => action,
        getString: (name: string) =>
          name === 'category' ? (category ?? null) : null,
      },
      reply,
    },
    reply,
  };
}

function preferenceStore(overrides: Record<string, unknown> = {}) {
  return {
    getMemberPreference: vi.fn().mockResolvedValue(undefined),
    setMemberPreference: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
