import {
  memberControllable,
  type BroadcastCategory,
} from '../notifications/broadcast-policy.js';
import type { BroadcastStore } from '../notifications/broadcast-store.js';

const safeMentions = { parse: [], repliedUser: false } as const;
const publicCategoryMessage =
  'That category is a public channel broadcast, so a personal toggle would not hide it. Ask a MuthaShip administrator to pause or move the broadcast instead.';
const unavailableMessage =
  'Notification preferences are temporarily unavailable.';

export interface NotificationCommandInteraction {
  readonly guildId: string | null;
  readonly user: Readonly<{ id: string; bot?: boolean }>;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
  }>;
  reply(
    payload: Readonly<{
      content: string;
      ephemeral: true;
      allowedMentions: typeof safeMentions;
    }>,
  ): Promise<unknown>;
}

export interface NotificationCommandDependencies {
  readonly store?: Pick<
    BroadcastStore,
    'getMemberPreference' | 'setMemberPreference'
  >;
  readonly now?: () => Date;
}

const respond = (
  interaction: NotificationCommandInteraction,
  content: string,
) =>
  interaction.reply({
    content,
    ephemeral: true,
    allowedMentions: safeMentions,
  });

export async function handleNotificationCommand(
  interaction: NotificationCommandInteraction,
  dependencies: NotificationCommandDependencies,
): Promise<void> {
  if (interaction.user.bot) {
    await respond(
      interaction,
      'Notification preferences are not available for bot users.',
    );
    return;
  }
  const serverId = interaction.guildId?.trim();
  if (!serverId) {
    await respond(
      interaction,
      'Notification preferences are available only in a MuthaShip server.',
    );
    return;
  }
  if (dependencies.store === undefined) {
    await respond(interaction, unavailableMessage);
    return;
  }

  try {
    const action = interaction.options.getSubcommand();
    if (action === 'status') {
      await respond(
        interaction,
        await statusMessage(dependencies.store, serverId, interaction.user.id),
      );
      return;
    }

    const category = interaction.options.getString('category');
    if (!isBroadcastCategory(category)) {
      await respond(interaction, 'Choose a valid notification category.');
      return;
    }
    if (!memberControllable(category)) {
      await respond(interaction, publicCategoryMessage);
      return;
    }
    if (!isMemberControlledCategory(category)) {
      await respond(interaction, 'Choose a valid notification category.');
      return;
    }
    if (action !== 'enable' && action !== 'disable') {
      await respond(interaction, 'Choose a valid notification action.');
      return;
    }

    const enabled = action === 'enable';
    await dependencies.store.setMemberPreference({
      serverId,
      userId: interaction.user.id,
      category,
      enabled,
      updatedAt: (dependencies.now ?? (() => new Date()))(),
    });
    await respond(
      interaction,
      `${labelFor(category)} are now ${enabled ? 'enabled' : 'disabled'} for you on this MuthaShip server.`,
    );
  } catch {
    await respond(
      interaction,
      'Notification preferences could not be updated. Please try again later.',
    );
  }
}

async function statusMessage(
  store: Required<NotificationCommandDependencies>['store'],
  serverId: string,
  userId: string,
): Promise<string> {
  const categories = ['event_reminder', 'birthday'] as const;
  const preferences = await Promise.all(
    categories.map((category) =>
      store.getMemberPreference(serverId, userId, category),
    ),
  );
  return [
    'Notification preferences for this MuthaShip server:',
    ...categories.map(
      (category, index) =>
        `• ${labelFor(category)}: ${preferences[index]?.enabled === true ? 'enabled' : 'disabled'}`,
    ),
  ].join('\n');
}

function isBroadcastCategory(value: string | null): value is BroadcastCategory {
  return (
    value === 'rss' ||
    value === 'proactive' ||
    value === 'recap' ||
    value === 'event_reminder' ||
    value === 'birthday'
  );
}

function isMemberControlledCategory(
  category: BroadcastCategory,
): category is 'event_reminder' | 'birthday' {
  return category === 'event_reminder' || category === 'birthday';
}

function labelFor(category: 'event_reminder' | 'birthday'): string {
  return category === 'event_reminder'
    ? 'Event reminders'
    : 'Birthday mentions';
}
