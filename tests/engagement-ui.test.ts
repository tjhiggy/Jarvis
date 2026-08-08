import { describe, expect, it } from 'vitest';
import {
  allowedMentionsForUsers,
  buildEngagementButton,
  buildEngagementCard,
  buildEngagementComponents,
  buildEngagementSelectMenu,
  privateEngagementError,
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
});
