import { describe, expect, it, vi } from 'vitest';
import {
  ImageGenerationError,
  ImageGenerationService,
} from '../src/images/image-generation.js';

describe('controlled image generation', () => {
  it('rejects unbounded and mention-bearing prompts before calling the provider', async () => {
    const generate = vi.fn();
    const service = new ImageGenerationService({ generate });

    await expect(service.generate('short')).rejects.toMatchObject({
      code: 'invalid-prompt',
    });
    await expect(
      service.generate('Create a banner for @everyone on the MuthaShip.'),
    ).rejects.toMatchObject({ code: 'unsafe-prompt' });
    await expect(service.generate('x'.repeat(1_001))).rejects.toMatchObject({
      code: 'invalid-prompt',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns one bounded PNG without retaining the prompt', async () => {
    const bytes = Buffer.from('png-image');
    const generate = vi.fn(async () => ({
      bytes,
      mediaType: 'image/png' as const,
    }));
    const service = new ImageGenerationService({ generate });

    await expect(
      service.generate('Create a purple MuthaShip command deck banner.'),
    ).resolves.toEqual({ bytes, mediaType: 'image/png' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('maps provider failures to a content-free service error', async () => {
    const service = new ImageGenerationService({
      generate: async () => {
        throw new Error('secret prompt and provider response');
      },
    });

    const failure = await service
      .generate('Create a safe image for the MuthaShip crew.')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ImageGenerationError);
    expect(failure).toMatchObject({ code: 'provider-unavailable' });
    expect(JSON.stringify(failure)).not.toMatch(
      /secret prompt|provider response/i,
    );
  });
});
