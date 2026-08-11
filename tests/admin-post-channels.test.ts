import { describe, expect, it } from 'vitest';
import { resolveAdminPostChannels } from '../src/admin/admin-post-channels.js';

describe('resolveAdminPostChannels', () => {
  it('uses the current Discord channel name when available', async () => {
    await expect(
      resolveAdminPostChannels(['1536175231373148181'], async () =>
        Promise.resolve('jarvis-testing'),
      ),
    ).resolves.toEqual([
      { id: '1536175231373148181', label: 'jarvis-testing' },
    ]);
  });

  it('keeps approved channels available when Discord lookup fails', async () => {
    const channels = await resolveAdminPostChannels(
      ['1536175231373148181', '953011731356086283'],
      async () => {
        throw new Error('Discord unavailable');
      },
    );

    expect(channels).toEqual([
      { id: '1536175231373148181', label: 'Approved channel 1' },
      { id: '953011731356086283', label: 'Approved channel 2' },
    ]);
    expect(channels.map(({ label }) => label).join(' ')).not.toContain(
      '1536175231373148181',
    );
  });
});
