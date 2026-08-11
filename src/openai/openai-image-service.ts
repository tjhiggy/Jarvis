import OpenAI from 'openai';
import type {
  GeneratedImage,
  ImageProvider,
} from '../images/image-generation.js';

export class OpenAIImageProvider implements ImageProvider {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    timeoutMs: number,
  ) {
    this.client = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async generate(prompt: string): Promise<GeneratedImage> {
    const response = await this.client.images.generate({
      model: this.model,
      prompt,
      n: 1,
      size: '1024x1024',
    });
    const encoded = response.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || encoded === '') {
      throw new Error('Image provider returned no image data.');
    }
    return { bytes: Buffer.from(encoded, 'base64'), mediaType: 'image/png' };
  }
}
