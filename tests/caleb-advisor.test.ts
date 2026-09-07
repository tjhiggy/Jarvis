import { describe, expect, it, vi } from 'vitest';
import {
  createCalebDiscordAdvisor,
  createLoopbackCalebHandoffClient,
  signCalebHandoff,
  type CalebHandoffRequest,
} from '../src/discord/caleb-advisor.js';
import {
  createDiscordHandlers,
  type MessageHandlerDependencies,
} from '../src/discord/handlers.js';

const secret = 'caleb-test-secret';
const base = {
  requestId: 'req-1',
  timestamp: 1_700_000_000_000,
  nonce: 'nonce-1',
  message: 'Please advise.',
  provenance: {
    guildId: 'guild',
    chat_id: 'channel',
    channel_id: 'channel',
    sourceMessageId: 'message',
    profileIdentity: 'caleb' as const,
    threadState: 'active' as const,
  },
};
const request = (): CalebHandoffRequest => ({
  ...base,
  signature: signCalebHandoff(base, secret),
});
const advisor = (
  capability = {
    submit_jarvis_handoff: vi.fn(async () => ({ success: true })),
  },
) =>
  createCalebDiscordAdvisor({ secret, now: () => base.timestamp, capability });

describe('Caleb Discord advisor boundary', () => {
  it('submits only with verified capability success and preserves provenance', async () => {
    const cap = {
      submit_jarvis_handoff: vi.fn(async () => ({ success: true })),
    };
    expect(await advisor(cap)(request())).toEqual({
      ok: true,
      message: 'Handoff submitted.',
    });
    expect(cap.submit_jarvis_handoff).toHaveBeenCalledWith(
      expect.objectContaining({ provenance: base.provenance }),
    );
  });

  it('routes real Discord output neutrally on failure and says submitted only on success', async () => {
    const replies: string[] = [];
    const message = {
      id: 'message-1',
      content: '<@bot> advise',
      guildId: 'guild',
      channelId: 'thread',
      channel: {
        parentId: 'thread',
        isThread: () => true,
        permissionsFor: () => ({ has: () => true }),
      },
      author: { id: 'user', bot: false },
      mentions: { users: { has: () => true } },
      reply: async (payload: { content?: string }) => {
        replies.push(payload.content ?? '');
      },
    };
    const baseDeps: Omit<MessageHandlerDependencies, 'calebAdvisor'> = {
      botUserId: 'bot',
      allowedChannelIds: new Set(['thread']),
      conversationService: {
        ask: async () => ({ status: 'success' as const, text: 'unused' }),
      },
      handleCommand: async () => {},
    };
    await createDiscordHandlers({
      ...baseDeps,
      calebAdvisor: async () => ({
        ok: false,
        message: 'Handoff unavailable.',
      }),
    }).onMessageCreate(message);
    expect(replies).toEqual(['Handoff unavailable.']);
    replies.length = 0;
    await createDiscordHandlers({
      ...baseDeps,
      calebAdvisor: async () => ({ ok: true, message: 'Handoff submitted.' }),
    }).onMessageCreate(message);
    expect(replies).toEqual(['Handoff submitted.']);
  });

  it('rejects non-thread provenance before a successful-looking handoff', async () => {
    let called = false;
    const message = {
      id: 'message-2',
      content: '<@bot> advise',
      guildId: 'guild',
      channelId: 'channel',
      channel: {
        parentId: null,
        isThread: () => false,
        permissionsFor: () => ({ has: () => true }),
      },
      author: { id: 'user', bot: false },
      mentions: { users: { has: () => true } },
      reply: async () => {},
    };
    await createDiscordHandlers({
      botUserId: 'bot',
      allowedChannelIds: new Set(['channel']),
      conversationService: {
        ask: async () => ({ status: 'success' as const, text: 'unused' }),
      },
      handleCommand: async () => {},
      calebAdvisor: async (request) => {
        called = true;
        expect(request.provenance.threadState).toBe('closed');
        return { ok: false, message: 'Request denied.' };
      },
    }).onMessageCreate(message);
    expect(called).toBe(false);
  });

  it('does not call an overridden loopback endpoint', async () => {
    const fetch = vi.fn();
    const client = createLoopbackCalebHandoffClient({
      secret,
      endpoint: 'https://attacker.invalid/handoff',
      fetch,
    });
    expect(await client(request())).toEqual({
      ok: false,
      message: 'Request denied.',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'accepts an explicit success payload',
      200,
      JSON.stringify({ success: true }),
      true,
    ],
    [
      'rejects a false success payload',
      200,
      JSON.stringify({ success: false }),
      false,
    ],
    ['rejects malformed JSON', 200, '{not-json', false],
    ['rejects a payload missing success', 200, JSON.stringify({}), false],
    [
      'rejects a non-2xx response',
      502,
      JSON.stringify({ success: true }),
      false,
    ],
  ])('%s', async (_caseName, status, body, succeeds) => {
    const fetch = vi.fn(async () => new Response(body, { status }));
    const client = createLoopbackCalebHandoffClient({
      secret,
      fetch,
      now: () => base.timestamp,
    });

    expect(await client(request())).toEqual(
      succeeds
        ? { ok: true, message: 'Handoff submitted.' }
        : { ok: false, message: 'Handoff unavailable.' },
    );
  });

  it('fails closed for no capability, disabled, provider failure, malformed, replay, duplicate, and unsupported thread', async () => {
    expect(
      await createCalebDiscordAdvisor({ secret, now: () => base.timestamp })(
        request(),
      ),
    ).toEqual({ ok: false, message: 'Request denied.' });
    expect(
      await createCalebDiscordAdvisor({
        secret,
        now: () => base.timestamp,
        disabled: true,
      })(request()),
    ).toEqual({ ok: false, message: 'Request denied.' });
    const cap = {
      submit_jarvis_handoff: vi.fn(async () => ({ success: false })),
    };
    const run = advisor(cap);
    expect((await run(request())).ok).toBe(false);
    expect((await run(request())).message).toBe('Handoff unavailable.');
    for (const change of [
      { message: '' },
      { signature: 'bad' },
      { provenance: { ...base.provenance, threadState: 'closed' as const } },
      { provenance: { ...base.provenance, chat_id: 'other' } },
    ])
      expect(
        (await advisor()({ ...request(), ...change } as CalebHandoffRequest))
          .ok,
      ).toBe(false);
  });

  it('releases the in-flight guard when the durable replay claim loses a race', async () => {
    const replayStore = { claim: vi.fn(async () => false) };
    const run = createCalebDiscordAdvisor({
      secret,
      now: () => base.timestamp,
      capability: {
        submit_jarvis_handoff: vi.fn(async () => ({ success: true })),
      },
      replayStore,
    });
    expect(await run(request())).toEqual({
      ok: false,
      message: 'Request denied.',
    });
    const secondUnsigned = { ...base, requestId: 'req-2', nonce: 'nonce-2' };
    expect(
      await run({
        ...secondUnsigned,
        signature: signCalebHandoff(secondUnsigned, secret),
      }),
    ).toEqual({
      ok: false,
      message: 'Request denied.',
    });
    expect(replayStore.claim).toHaveBeenCalledTimes(2);
  });

  it('denies a loopback client without a secret without attempting transport', async () => {
    const fetch = vi.fn();
    const client = createLoopbackCalebHandoffClient({
      fetch,
      now: () => base.timestamp,
    });
    expect(await client(request())).toEqual({
      ok: false,
      message: 'Request denied.',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('redacts all internal detail from Discord results and uses canonical HMAC', async () => {
    const cap = {
      submit_jarvis_handoff: vi.fn(async () => {
        throw new Error('model token URL header routing exception');
      }),
    };
    const result = await advisor(cap)(request());
    expect(JSON.stringify(result)).not.toMatch(
      /model|token|URL|header|routing|exception|127\.0\.0\.1|caleb-test/,
    );
    expect(signCalebHandoff(base, secret)).toMatch(/^[a-f0-9]{64}$/);
  });
});
