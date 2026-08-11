import { describe, expect, it, vi } from 'vitest';
import { Instrumentation } from '../src/platform/instrumentation.js';

describe('member statistics instrumentation', () => {
  const context = {
    serverId: 'server-1',
    channelId: 'channel-1',
    userId: 'crew-1',
    correlationId: 'command-1',
    surface: 'discord' as const,
    isAdministrator: false,
  };

  it('records successful commands without changing command behavior', async () => {
    const recordCommand = vi.fn(async () => undefined);
    const instrumentation = new Instrumentation(
      { record: async () => undefined },
      { recordCommand },
    );

    await expect(
      instrumentation.run({
        context,
        feature: 'ask',
        command: 'ask',
        operation: async () => 'answer',
      }),
    ).resolves.toBe('answer');
    expect(recordCommand).toHaveBeenCalledWith(
      'server-1',
      'crew-1',
      'ask',
      expect.any(Date),
    );
  });

  it('does not record failed commands or the preference command itself', async () => {
    const recordCommand = vi.fn(async () => undefined);
    const instrumentation = new Instrumentation(
      { record: async () => undefined },
      { recordCommand },
    );
    await expect(
      instrumentation.run({
        context,
        feature: 'ask',
        command: 'ask',
        operation: async () => {
          throw new Error('failed');
        },
      }),
    ).rejects.toThrow('failed');
    await instrumentation.run({
      context,
      feature: 'my-stats',
      command: 'my-stats',
      operation: async () => undefined,
    });
    expect(recordCommand).not.toHaveBeenCalled();
  });
});
