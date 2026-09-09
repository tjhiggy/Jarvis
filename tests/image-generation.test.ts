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

  it.each(['   ', 'x'.repeat(19), `\n${'x'.repeat(19)}\t`])(
    'rejects a prompt outside the 20-to-1000 character bound',
    async (prompt) => {
      const generate = vi.fn();
      const service = new ImageGenerationService({ generate });
      await expect(service.generate(prompt)).rejects.toMatchObject({
        code: 'invalid-prompt',
      });
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    'Create a MuthaShip banner that says @HERE for the crew.',
    'Create a MuthaShip banner pinging <@&12345678901234567>.',
  ])(
    'rejects @here and role-mention prompts before the provider',
    async (prompt) => {
      const generate = vi.fn();
      const service = new ImageGenerationService({ generate });
      await expect(service.generate(prompt)).rejects.toMatchObject({
        code: 'unsafe-prompt',
      });
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { bytes: Buffer.alloc(0), mediaType: 'image/png' as const },
    {
      bytes: Buffer.alloc(10 * 1024 * 1024 + 1),
      mediaType: 'image/png' as const,
    },
    { bytes: Buffer.from('gif'), mediaType: 'image/gif' as const },
  ])(
    'rejects an invalid provider image without wrapping the code',
    async (result) => {
      const service = new ImageGenerationService({
        generate: async () => result as never,
      });
      await expect(
        service.generate('Create a purple MuthaShip command deck banner.'),
      ).rejects.toMatchObject({ code: 'invalid-image' });
    },
  );

  it('accepts jpeg and webp payloads and copies the bytes', async () => {
    const jpeg = Buffer.from('jpeg-image');
    const webp = Buffer.from('webp-image');
    const jpegService = new ImageGenerationService({
      generate: async () => ({ bytes: jpeg, mediaType: 'image/jpeg' }),
    });
    const webpService = new ImageGenerationService({
      generate: async () => ({ bytes: webp, mediaType: 'image/webp' }),
    });

    const jpegResult = await jpegService.generate(
      'Create a purple MuthaShip command deck banner.',
    );
    jpeg.fill(0);
    expect(jpegResult).toEqual({
      bytes: Buffer.from('jpeg-image'),
      mediaType: 'image/jpeg',
    });
    await expect(
      webpService.generate('Create a purple MuthaShip command deck banner.'),
    ).resolves.toEqual({ bytes: webp, mediaType: 'image/webp' });
  });

  it('rethrows a typed image-generation error from the provider', async () => {
    const service = new ImageGenerationService({
      generate: async () => {
        throw new ImageGenerationError('unsafe-prompt');
      },
    });
    await expect(
      service.generate('Create a purple MuthaShip command deck banner.'),
    ).rejects.toMatchObject({ code: 'unsafe-prompt' });
  });
});
