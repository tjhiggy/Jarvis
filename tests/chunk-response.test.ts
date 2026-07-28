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
    expect(chunkDiscordResponse('alpha\n\nbeta', 10)).toEqual([
      'alpha\n\n',
      'beta',
    ]);
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

  it('rejects a limit that cannot hold a full Unicode code point', () => {
    expect(() => chunkDiscordResponse('😀', 1)).toThrow(RangeError);
  });

  it('closes and reopens fenced blocks so every chunk is valid Discord markdown', () => {
    const chunks = chunkDiscordResponse(
      '```ts\n' + 'x'.repeat(80) + '\n```',
      40,
    );

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

  it('keeps fenced Unicode chunks within the caller limit', () => {
    const chunks = chunkDiscordResponse('```ts\n😀\n```', 11);

    expect(chunks.every((chunk) => chunk.length <= 11)).toBe(true);
  });

  it('preserves separators when synthetic fence markers are removed', () => {
    const content = '```txt\none\n\ntwo';
    const chunks = chunkDiscordResponse(content, 13);
    const reconstructed = chunks
      .map((chunk, index) => {
        const withoutSyntheticOpen =
          index === 0 ? chunk : chunk.replace(/^```txt\n/, '');
        return withoutSyntheticOpen.replace(/\n```$/, '');
      })
      .join('');

    expect(reconstructed).toBe(content);
  });

  it('balances and reopens a long unclosed fenced block when its wrapper fits', () => {
    const chunks = chunkDiscordResponse('```ts\n' + 'x'.repeat(80), 40);

    expect(chunks.every((chunk) => chunk.length <= 40)).toBe(true);
    expect(
      chunks.every((chunk) => (chunk.match(/```/g) ?? []).length % 2 === 0),
    ).toBe(true);
    expect(chunks.slice(1).every((chunk) => chunk.startsWith('```ts\n'))).toBe(
      true,
    );
  });
});
