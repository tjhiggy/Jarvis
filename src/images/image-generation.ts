export type GeneratedImage = Readonly<{
  bytes: Buffer;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
}>;

export interface ImageProvider {
  generate(prompt: string): Promise<GeneratedImage>;
}

export type ImageGenerationErrorCode =
  'invalid-prompt' | 'unsafe-prompt' | 'provider-unavailable' | 'invalid-image';

export class ImageGenerationError extends Error {
  constructor(readonly code: ImageGenerationErrorCode) {
    super(`Image generation failed: ${code}`);
    this.name = 'ImageGenerationError';
  }
}

export class ImageGenerationService {
  constructor(private readonly provider: ImageProvider) {}

  async generate(rawPrompt: string): Promise<GeneratedImage> {
    const prompt = rawPrompt.trim();
    if (prompt.length < 20 || prompt.length > 1_000) {
      throw new ImageGenerationError('invalid-prompt');
    }
    if (/@(?:everyone|here)\b|<@&\d{17,20}>/i.test(prompt)) {
      throw new ImageGenerationError('unsafe-prompt');
    }
    try {
      const result = await this.provider.generate(prompt);
      if (
        !Buffer.isBuffer(result.bytes) ||
        result.bytes.length < 1 ||
        result.bytes.length > 10 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(result.mediaType)
      ) {
        throw new ImageGenerationError('invalid-image');
      }
      return { bytes: Buffer.from(result.bytes), mediaType: result.mediaType };
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      throw new ImageGenerationError('provider-unavailable');
    }
  }
}
