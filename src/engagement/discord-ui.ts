import type { AllowedMentions, ReplyPayload } from '../discord/delivery.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

const DISCORD_MESSAGE_LIMIT = 2_000;
const EMBED_TITLE_LIMIT = 256;
const EMBED_DESCRIPTION_LIMIT = 4_096;
const EMBED_FIELD_NAME_LIMIT = 256;
const EMBED_FIELD_VALUE_LIMIT = 1_024;
const EMBED_FIELD_COUNT_LIMIT = 25;
const EMBED_TOTAL_LIMIT = 6_000;
const ACTION_ROW_LIMIT = 5;
const COMPONENTS_PER_ROW_LIMIT = 5;
const CUSTOM_ID_LIMIT = 100;
const SELECT_OPTION_LIMIT = 25;

export interface EngagementEmbedField {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

export interface EngagementEmbed {
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly EngagementEmbedField[];
}

export interface EngagementButton {
  readonly type: 'button';
  readonly customId: string;
  readonly label: string;
  readonly style: 'primary' | 'secondary' | 'success' | 'danger';
  readonly disabled?: boolean;
}

export interface EngagementSelectMenu {
  readonly type: 'select';
  readonly customId: string;
  readonly placeholder: string;
  readonly options: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly disabled?: boolean;
}

export interface EngagementActionRow {
  readonly type: 'actionRow';
  readonly components: readonly (EngagementButton | EngagementSelectMenu)[];
}

export interface EngagementCard extends ReplyPayload {
  readonly embeds: readonly EngagementEmbed[];
  readonly components?: readonly EngagementActionRow[];
}

export interface DiscordEngagementCard extends ReplyPayload {
  readonly embeds: readonly EngagementEmbed[];
  readonly components?: readonly {
    readonly type: 1;
    readonly components: readonly (
      | {
          readonly type: 2;
          readonly custom_id: string;
          readonly label: string;
          readonly style: 1 | 2 | 3 | 4;
          readonly disabled?: boolean;
        }
      | {
          readonly type: 3;
          readonly custom_id: string;
          readonly placeholder: string;
          readonly options: readonly {
            readonly label: string;
            readonly value: string;
          }[];
          readonly disabled?: boolean;
        }
    )[];
  }[];
}

const mentionsOff: AllowedMentions = Object.freeze({
  parse: Object.freeze([]),
  repliedUser: false,
});

const requireBounded = (
  value: string,
  limit: number,
  label: string,
): string => {
  const normalized = neutralizeDiscordMentions(value).trim();
  if (normalized === '') throw new RangeError(`${label} is required.`);
  if (normalized.length > limit) {
    throw new RangeError(
      `${label} must be at most ${limit.toLocaleString()} characters.`,
    );
  }
  return normalized;
};

export const buildEngagementButton = (
  input: Omit<EngagementButton, 'type'>,
): EngagementButton => ({
  type: 'button',
  ...input,
  customId: requireBounded(input.customId, CUSTOM_ID_LIMIT, 'Button custom ID'),
  label: requireBounded(input.label, 80, 'Button label'),
});

export const buildEngagementSelectMenu = (
  input: Omit<EngagementSelectMenu, 'type'>,
): EngagementSelectMenu => {
  if (
    input.options.length === 0 ||
    input.options.length > SELECT_OPTION_LIMIT
  ) {
    throw new RangeError(
      `Select menus require between 1 and ${SELECT_OPTION_LIMIT} options.`,
    );
  }
  return {
    type: 'select',
    ...input,
    customId: requireBounded(
      input.customId,
      CUSTOM_ID_LIMIT,
      'Select custom ID',
    ),
    placeholder: requireBounded(input.placeholder, 150, 'Select placeholder'),
    options: input.options.map((option) => ({
      label: requireBounded(option.label, 100, 'Select option label'),
      value: requireBounded(option.value, 100, 'Select option value'),
    })),
  };
};

export const buildEngagementComponents = (
  rows: readonly EngagementActionRow[],
): readonly EngagementActionRow[] => {
  if (rows.length > ACTION_ROW_LIMIT) {
    throw new RangeError('Discord permits at most five action rows.');
  }
  for (const row of rows) {
    if (
      row.components.length === 0 ||
      row.components.length > COMPONENTS_PER_ROW_LIMIT
    ) {
      throw new RangeError(
        'Each action row must contain between 1 and 5 components.',
      );
    }
    if (
      row.components.filter((component) => component.type === 'select').length >
        0 &&
      row.components.length !== 1
    ) {
      throw new RangeError('A select menu must occupy its own action row.');
    }
  }
  return rows;
};

export const buildEngagementCard = (input: {
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly EngagementEmbedField[];
  readonly content?: string;
  readonly components?: readonly EngagementActionRow[];
}): EngagementCard => {
  const title = requireBounded(input.title, EMBED_TITLE_LIMIT, 'Embed title');
  const description =
    input.description === undefined
      ? undefined
      : requireBounded(
          input.description,
          EMBED_DESCRIPTION_LIMIT,
          'Embed description',
        );
  const fields = input.fields?.map((field) => ({
    ...field,
    name: requireBounded(
      field.name,
      EMBED_FIELD_NAME_LIMIT,
      'Embed field name',
    ),
    value: requireBounded(
      field.value,
      EMBED_FIELD_VALUE_LIMIT,
      'Embed field value',
    ),
  }));
  if ((fields?.length ?? 0) > EMBED_FIELD_COUNT_LIMIT) {
    throw new RangeError(
      `Discord permits at most ${EMBED_FIELD_COUNT_LIMIT} embed fields.`,
    );
  }
  const totalLength =
    title.length +
    (description?.length ?? 0) +
    (fields ?? []).reduce(
      (total, field) => total + field.name.length + field.value.length,
      0,
    );
  if (totalLength > EMBED_TOTAL_LIMIT) {
    throw new RangeError(
      `Embed content must be at most ${EMBED_TOTAL_LIMIT.toLocaleString()} characters.`,
    );
  }
  const content =
    input.content === undefined
      ? undefined
      : requireBounded(input.content, DISCORD_MESSAGE_LIMIT, 'Message content');
  const components =
    input.components === undefined
      ? undefined
      : buildEngagementComponents(input.components);
  return {
    ...(content === undefined ? {} : { content }),
    embeds: [
      {
        title,
        ...(description === undefined ? {} : { description }),
        ...(fields === undefined ? {} : { fields }),
      },
    ],
    ...(components === undefined ? {} : { components }),
    allowedMentions: mentionsOff,
  };
};

const discordButtonStyle = (
  style: EngagementButton['style'],
): 1 | 2 | 3 | 4 => {
  const styles: Readonly<Record<EngagementButton['style'], 1 | 2 | 3 | 4>> = {
    primary: 1,
    secondary: 2,
    success: 3,
    danger: 4,
  };
  return styles[style];
};

export const toDiscordEngagementCard = (
  card: EngagementCard,
): DiscordEngagementCard => {
  const { components, ...payload } = card;
  return {
    ...payload,
    ...(components === undefined
      ? {}
      : {
          components: components.map((row) => ({
            type: 1 as const,
            components: row.components.map((component) =>
              component.type === 'button'
                ? {
                    type: 2 as const,
                    custom_id: component.customId,
                    label: component.label,
                    style: discordButtonStyle(component.style),
                    ...(component.disabled === undefined
                      ? {}
                      : { disabled: component.disabled }),
                  }
                : {
                    type: 3 as const,
                    custom_id: component.customId,
                    placeholder: component.placeholder,
                    options: component.options,
                    ...(component.disabled === undefined
                      ? {}
                      : { disabled: component.disabled }),
                  },
            ),
          })),
        }),
  };
};

export const privateEngagementError = (message: string): ReplyPayload => ({
  content: requireBounded(message, DISCORD_MESSAGE_LIMIT, 'Error message'),
  ephemeral: true,
  allowedMentions: mentionsOff,
});

export const allowedMentionsForUsers = (
  userIds: readonly string[],
): AllowedMentions => {
  const users = [...new Set(userIds.map((userId) => userId.trim()))];
  if (users.some((userId) => !/^\d{5,20}$/.test(userId))) {
    throw new RangeError('Discord user IDs must be numeric snowflakes.');
  }
  return users.length === 0 ? mentionsOff : { ...mentionsOff, users };
};
