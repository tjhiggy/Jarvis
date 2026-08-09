import { describe, expect, it } from 'vitest';
import {
  allowedMentionsForUsers,
  buildEngagementButton,
  buildEngagementCard,
  buildEngagementComponents,
  buildEngagementSelectMenu,
  privateEngagementError,
  toDiscordEngagementCard,
} from '../src/engagement/discord-ui.js';

describe('engagement Discord UI', () => {
  it('builds a safe private error with mentions disabled', () => {
    expect(privateEngagementError('@everyone nope')).toEqual({
      content: '@\u200beveryone nope',
      ephemeral: true,
      allowedMentions: { parse: [], repliedUser: false },
    });
  });

  it('rejects card fields that exceed Discord limits', () => {
    expect(() =>
      buildEngagementCard({
        title: 'A valid title',
        fields: [{ name: 'Details', value: 'x'.repeat(1_025) }],
      }),
    ).toThrow(/field value/i);
  });

  it('rejects more than five action rows and custom IDs over 100 characters', () => {
    const row = { type: 'actionRow' as const, components: [] };
    expect(() =>
      buildEngagementComponents([row, row, row, row, row, row]),
    ).toThrow(/five action rows/i);
    expect(() =>
      buildEngagementSelectMenu({
        customId: 'x'.repeat(101),
        placeholder: 'Choose one',
        options: [{ label: 'One', value: 'one' }],
      }),
    ).toThrow(/custom ID/i);
    expect(() =>
      buildEngagementButton({
        customId: 'x'.repeat(101),
        label: 'Confirm',
        style: 'primary',
      }),
    ).toThrow(/custom ID/i);
  });

  it('rejects a message body over Discord’s 2,000-character limit', () => {
    expect(() =>
      buildEngagementCard({ title: 'Status', content: 'x'.repeat(2_001) }),
    ).toThrow(/2,000/i);
  });

  it('permits only named user IDs when an explicit mention is required', () => {
    expect(allowedMentionsForUsers(['123456789012345678'])).toEqual({
      parse: [],
      repliedUser: false,
      users: ['123456789012345678'],
    });
    expect(() => allowedMentionsForUsers(['@everyone'])).toThrow(/user IDs/i);
  });

  it('serializes internal component labels into Discord API component types', () => {
    expect(
      toDiscordEngagementCard(
        buildEngagementCard({
          title: 'Review',
          components: [
            {
              type: 'actionRow',
              components: [
                buildEngagementButton({
                  customId: 'preview:v1:introduction:draft-1:confirm',
                  label: 'Confirm',
                  style: 'success',
                }),
              ],
            },
          ],
        }),
      ),
    ).toMatchObject({
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              custom_id: 'preview:v1:introduction:draft-1:confirm',
              label: 'Confirm',
              style: 3,
            },
          ],
        },
      ],
    });
  });
});
