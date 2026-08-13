import { describe, expect, it } from 'vitest';
import { buildEntertainmentCatalog } from '../src/community/entertainment.js';

describe('community entertainment catalog', () => {
  it('keeps bounded, allowlisted community activities', () => {
    expect(
      buildEntertainmentCatalog([
        {
          id: '1',
          kind: 'challenge',
          title: 'Daily challenge',
          prompt: 'Share a win',
          enabled: true,
        },
      ]),
    ).toEqual({
      items: [
        {
          id: '1',
          kind: 'challenge',
          title: 'Daily challenge',
          prompt: 'Share a win',
          enabled: true,
        },
      ],
      enabledKinds: ['challenge'],
    });
  });
  it('rejects unsupported and unbounded entries', () => {
    expect(
      buildEntertainmentCatalog([
        {
          id: '',
          kind: 'quote' as never,
          title: ' ',
          prompt: 'x',
          enabled: true,
        },
        {
          id: '2',
          kind: 'meme',
          title: 'm',
          prompt: 'x'.repeat(700),
          enabled: false,
        },
      ]).items[0]?.prompt,
    ).toHaveLength(500);
  });
});
