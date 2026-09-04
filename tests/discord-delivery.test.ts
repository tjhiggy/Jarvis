import { describe, expect, it, vi } from 'vitest';
import {
  allowedMentions,
  editDeferredReplySafely,
  replyImmediatelyInChunksSafely,
  replySafely,
} from '../src/discord/delivery.js';

const emptyMentions = { parse: [], repliedUser: false };

describe('replySafely', () => {
  it('neutralizes mentions and always disables parse and repliedUser', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);

    await replySafely(
      { reply },
      'Status for @everyone <@123> and <#456>',
      true,
    );

    expect(reply).toHaveBeenCalledWith({
      content: 'Status for @\u200beveryone <@\u200b123> and <#\u200b456>',
      ephemeral: true,
      allowedMentions,
    });
    expect(reply.mock.calls[0]?.[0].allowedMentions).toEqual(emptyMentions);
    expect(Object.isFrozen(reply.mock.calls[0]?.[0].allowedMentions)).toBe(
      true,
    );
  });

  it('replaces blank or whitespace-only content with a bounded fallback', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);

    await replySafely({ reply }, '   ');

    expect(reply).toHaveBeenCalledWith({
      content: 'No response was available.',
      ephemeral: false,
      allowedMentions,
    });
  });
});

describe('chunked safe replies', () => {
  it('replies and follows up with neutralized chunks and empty mentions', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    const first = `${'A'.repeat(1_990)}\n\n`;

    await replyImmediatelyInChunksSafely(
      { reply, followUp },
      `${first}beta @here`,
      true,
    );

    expect(reply).toHaveBeenCalledWith({
      content: first,
      ephemeral: true,
      allowedMentions,
    });
    expect(followUp).toHaveBeenCalledWith({
      content: 'beta @\u200bhere',
      ephemeral: true,
      allowedMentions,
    });
  });

  it('edits a deferred reply with the fallback when content is empty', async () => {
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);

    await editDeferredReplySafely({ editReply, followUp }, '');

    expect(editReply).toHaveBeenCalledWith({
      content: 'No response was available.',
      allowedMentions,
    });
    expect(followUp).not.toHaveBeenCalled();
  });
});
