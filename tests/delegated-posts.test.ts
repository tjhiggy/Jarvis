import { describe, expect, it } from 'vitest';
import {
  DelegatedPostError,
  DelegatedPostService,
} from '../src/engagement/delegated-posts.js';
describe('delegated posts', () => {
  const setup = () => {
    const sent: any[] = [];
    const service = new DelegatedPostService({
      createId: () => 'draft-1',
      adminRoleIds: new Set(['admin']),
      gateway: {
        post: async (_c, card) => {
          sent.push(card);
          return { id: 'msg-1' };
        },
      },
    });
    return { service, sent };
  };
  it('requires admin and creates a private draft', () => {
    const { service } = setup();
    expect(() =>
      service.preview({
        guildId: 'g',
        ownerUserId: 'u',
        ownerName: 'U',
        ownerRoleIds: new Set(),
        channelId: 'c',
        content: 'hello',
      }),
    ).toThrowError(new DelegatedPostError('forbidden'));
    const draft = service.preview({
      guildId: 'g',
      ownerUserId: 'u',
      ownerName: 'U',
      ownerRoleIds: new Set(['admin']),
      channelId: 'c',
      content: 'ping @everyone',
    });
    expect(draft.content).toBe('ping @​everyone');
  });
  it('confirms once and prevents duplicate drafts', async () => {
    const { service, sent } = setup();
    const input = {
      guildId: 'g',
      ownerUserId: 'u',
      ownerName: 'U',
      ownerRoleIds: new Set(['admin']),
      channelId: 'c',
      content: 'hello',
    };
    const draft = service.preview(input);
    expect(() => service.preview(input)).toThrowError(
      new DelegatedPostError('duplicate'),
    );
    await expect(
      service.confirm({ guildId: 'g', ownerUserId: 'u', draftId: draft.id }),
    ).resolves.toEqual({ id: 'msg-1' });
    expect(sent[0].embeds[0].title).toBe('MuthaShip transmission');
    await expect(
      service.confirm({ guildId: 'g', ownerUserId: 'u', draftId: draft.id }),
    ).rejects.toThrow();
  });
});
