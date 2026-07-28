import { describe, expect, it } from 'vitest';
import { chunkDiscordResponse } from '../src/utils/chunk-response.js';

describe('chunkDiscordResponse', () => {
  it('returns no chunks for empty content', () => {
    expect(chunkDiscordResponse('')).toEqual([]);
  });

  it('keeps content at the exact limit in one chunk', () => {
    expect(chunkDiscordResponse('x'.repeat(40), 40)).toEqual(['x'.repeat(40)]);
  });

  it('prefers paragraph boundaries before smaller separators', () => {
    expect(chunkDiscordResponse('alpha\n\nbeta', 10)).toEqual(['alpha', 'beta']);
  });

  it('falls back to hard splits when no separator fits', () => {
    expect(chunkDiscordResponse('abcdefghijk', 5)).toEqual([
      'abcde',
      'fghij',
      'k',
    ]);
  });

  it('does not split surrogate pairs while making hard chunks', () => {
    const chunks = chunkDiscordResponse('😀😀😀', 3);

    expect(chunks).toEqual(['😀', '😀', '😀']);
    expect(chunks.every((chunk) => chunk.length <= 3)).toBe(true);
    expect(chunks.join('')).toBe('😀😀😀');
  });

  it('keeps a code point intact when its UTF-16 length exceeds the limit', () => {
    expect(chunkDiscordResponse('😀', 1)).toEqual(['😀']);
  });

  it('closes and reopens fenced blocks so every chunk is valid Discord markdown', () => {
    const chunks = chunkDiscordResponse('```ts\n' + 'x'.repeat(80) + '\n```', 40);

    expect(chunks.every((chunk) => chunk.length <= 40)).toBe(true);
    expect(
      chunks.every((chunk) => (chunk.match(/```/g) ?? []).length % 2 === 0),
    ).toBe(true);
    expect(chunks.slice(1).every((chunk) => chunk.startsWith('```ts\n'))).toBe(
      true,
    );
  });

  it('preserves an empty fenced block as a non-empty chunk', () => {
    expect(chunkDiscordResponse('```ts\n\n```', 40)).toEqual(['```ts\n\n```']);
  });
});
