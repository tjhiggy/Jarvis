import { describe, expect, it, vi } from 'vitest';
import {
  allowedMentions,
  editDeferredReplySafely,
  replyImmediatelyInChunksSafely,
  replySafely,
} from '../src/discord/delivery.js';

describe('Discord delivery', () => {
  it('neutralizes mentions, freezes empty allowedMentions, and replaces blank content', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);

    await replySafely({ reply }, '  @everyone check <#123>  ', true);

    expect(reply).toHaveBeenCalledWith({
      content: '@\u200beveryone check <#\u200b123>',
      ephemeral: true,
      allowedMentions,
    });
    expect(allowedMentions).toEqual({ parse: [], repliedUser: false });
    expect(Object.isFrozen(allowedMentions)).toBe(true);
    expect(Object.isFrozen(allowedMentions.parse)).toBe(true);
    expect(() => {
      (allowedMentions as unknown as { parse: string[] }).parse.push('users');
    }).toThrow();

    await replySafely({ reply }, '   \n  ');

    expect(reply).toHaveBeenLastCalledWith({
      content: 'No response was available.',
      ephemeral: false,
      allowedMentions,
    });
  });

  it('replies and follows up in chunks with the same mention lock', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    const first = `Hello @everyone\n\n`;
    const rest = 'B'.repeat(2_000);

    await replyImmediatelyInChunksSafely(
      { reply, followUp },
      `${first}${rest}`,
      true,
    );

    expect(reply).toHaveBeenCalledWith({
      content: 'Hello @\u200beveryone\n\n',
      ephemeral: true,
      allowedMentions,
    });
    expect(followUp).toHaveBeenCalledWith({
      content: rest,
      ephemeral: true,
      allowedMentions,
    });
  });

  it('edits a deferred reply and uses the empty fallback when content is blank', async () => {
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);

    await editDeferredReplySafely({ editReply, followUp }, '   ');

    expect(editReply).toHaveBeenCalledWith({
      content: 'No response was available.',
      allowedMentions,
    });
    expect(followUp).not.toHaveBeenCalled();
  });
});
