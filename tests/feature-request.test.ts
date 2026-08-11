import { describe, expect, it } from 'vitest';
import {
  FeatureRequestService,
  HttpGitHubIssueCreateService,
} from '../src/github/feature-request.js';

describe('Discord feature request intake', () => {
  it('previews, confirms once, and creates one bounded labeled issue', async () => {
    const created: unknown[] = [];
    const service = new FeatureRequestService({
      github: {
        createIssue: async (request) => {
          created.push(request);
          return {
            number: 212,
            url: 'https://github.com/tjhiggy/Jarvis/issues/212',
          };
        },
      },
      now: () => new Date('2026-08-11T18:00:00Z'),
    });

    const draft = service.preview({
      serverId: 'server-1',
      channelId: 'channel-1',
      ownerId: 'admin-1',
      title: 'Improve crew onboarding',
      description: 'Make the first-time experience easier to understand.',
    });
    const result = await service.confirm({
      draftId: draft.id,
      serverId: 'server-1',
      channelId: 'channel-1',
      ownerId: 'admin-1',
    });

    expect(result).toEqual({
      number: 212,
      url: 'https://github.com/tjhiggy/Jarvis/issues/212',
    });
    expect(created).toEqual([
      expect.objectContaining({
        title: 'Improve crew onboarding',
        labels: ['needs-triage', 'discord-request'],
      }),
    ]);
    await expect(
      service.confirm({
        draftId: draft.id,
        serverId: 'server-1',
        channelId: 'channel-1',
        ownerId: 'admin-1',
      }),
    ).rejects.toThrow(/draft/i);
  });

  it('keeps failed confirmations retryable', async () => {
    let attempts = 0;
    const service = new FeatureRequestService({
      github: {
        createIssue: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('outage');
          return {
            number: 213,
            url: 'https://github.com/tjhiggy/Jarvis/issues/213',
          };
        },
      },
    });
    const draft = service.preview({
      serverId: 'server-1',
      channelId: 'channel-1',
      ownerId: 'admin-1',
      title: 'Retry safely',
      description: 'Do not lose the draft when GitHub is unavailable.',
    });

    await expect(
      service.confirm({
        draftId: draft.id,
        serverId: 'server-1',
        channelId: 'channel-1',
        ownerId: 'admin-1',
      }),
    ).rejects.toThrow('outage');
    await expect(
      service.confirm({
        draftId: draft.id,
        serverId: 'server-1',
        channelId: 'channel-1',
        ownerId: 'admin-1',
      }),
    ).resolves.toMatchObject({ number: 213 });
  });

  it('reuses an equivalent active preview to prevent duplicate issue creation', () => {
    const service = new FeatureRequestService({
      github: {
        createIssue: async () => ({ number: 1, url: 'https://example.test/1' }),
      },
    });
    const input = {
      serverId: 'server-1',
      channelId: 'channel-1',
      ownerId: 'admin-1',
      title: 'Duplicate-safe preview',
      description: 'The same Discord delivery must reuse its active draft.',
    };

    expect(service.preview(input).id).toBe(service.preview(input).id);
  });

  it('rejects confirmation outside the preview channel', async () => {
    const service = new FeatureRequestService({
      github: {
        createIssue: async () => ({ number: 1, url: 'https://example.test/1' }),
      },
    });
    const draft = service.preview({
      serverId: 'server-1',
      channelId: 'channel-1',
      ownerId: 'admin-1',
      title: 'Channel-bound preview',
      description: 'Confirmation stays bound to its original Discord channel.',
    });

    await expect(
      service.confirm({
        draftId: draft.id,
        serverId: 'server-1',
        channelId: 'channel-2',
        ownerId: 'admin-1',
      }),
    ).rejects.toThrow(/draft/i);
  });

  it('does not cancel a draft while confirmation is in flight', async () => {
    let release!: (value: { number: number; url: string }) => void;
    const pending = new Promise<{ number: number; url: string }>((resolve) => {
      release = resolve;
    });
    const service = new FeatureRequestService({
      github: { createIssue: async () => pending },
    });
    const identity = {
      serverId: 'server-1',
      channelId: 'channel-1',
      ownerId: 'admin-1',
    };
    const draft = service.preview({
      ...identity,
      title: 'Race-safe cancellation',
      description: 'Cancellation cannot claim success during confirmation.',
    });
    const confirmation = service.confirm({ draftId: draft.id, ...identity });

    expect(service.cancel({ draftId: draft.id, ...identity })).toBe(false);
    release({ number: 215, url: 'https://example.test/215' });
    await expect(confirmation).resolves.toMatchObject({ number: 215 });
  });

  it('reconciles an ambiguous GitHub response without a duplicate POST', async () => {
    let createdBody = '';
    let postCount = 0;
    const github = new HttpGitHubIssueCreateService(
      'tjhiggy',
      'Jarvis',
      'token',
      8_000,
      async (_input, init) => {
        if (init?.method === 'POST') {
          postCount += 1;
          createdBody = String(JSON.parse(String(init.body)).body);
          throw new Error('response lost');
        }
        return new Response(
          JSON.stringify(
            createdBody
              ? [
                  {
                    number: 216,
                    html_url: 'https://example.test/216',
                    body: createdBody,
                  },
                ]
              : [],
          ),
          { status: 200 },
        );
      },
    );
    const service = new FeatureRequestService({ github });
    const identity = {
      serverId: 'server-1',
      channelId: 'channel-1',
      ownerId: 'admin-1',
    };
    const draft = service.preview({
      ...identity,
      title: 'Reconcile ambiguous delivery',
      description: 'A lost response must not create a second GitHub issue.',
    });

    await expect(
      service.confirm({ draftId: draft.id, ...identity }),
    ).rejects.toThrow();
    await expect(
      service.confirm({ draftId: draft.id, ...identity }),
    ).resolves.toMatchObject({
      number: 216,
    });
    expect(postCount).toBe(1);
  });

  it('posts only to the configured repository with approved labels', async () => {
    let requestUrl = '';
    let requestBody = '';
    const service = new HttpGitHubIssueCreateService(
      'tjhiggy',
      'Jarvis',
      'token',
      8_000,
      async (input, init) => {
        requestUrl = String(input);
        requestBody = String(init?.body);
        if (init?.method !== 'POST') {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            number: 214,
            html_url: 'https://github.com/tjhiggy/Jarvis/issues/214',
          }),
          { status: 201 },
        );
      },
    );

    const result = await service.createIssue({
      title: 'Safe issue',
      body: 'Bounded body',
      labels: ['needs-triage', 'discord-request'],
      idempotencyKey: 'draft-214',
    });

    expect(requestUrl).toBe(
      'https://api.github.com/repos/tjhiggy/Jarvis/issues',
    );
    expect(JSON.parse(requestBody)).toEqual({
      title: 'Safe issue',
      body: 'Bounded body\n\n<!-- jarvis-feature-request:draft-214 -->',
      labels: ['needs-triage', 'discord-request'],
    });
    expect(result.number).toBe(214);
  });

  it('reconciles beyond the first page before considering a new POST', async () => {
    let postCount = 0;
    const marker = '<!-- jarvis-feature-request:older-draft -->';
    const service = new HttpGitHubIssueCreateService(
      'tjhiggy',
      'Jarvis',
      'token',
      8_000,
      async (input, init) => {
        if (init?.method === 'POST') {
          postCount += 1;
          return new Response('{}', { status: 500 });
        }
        const page = new URL(String(input)).searchParams.get('page');
        return new Response(
          JSON.stringify(
            page === '1'
              ? Array.from({ length: 100 }, (_, index) => ({
                  number: index + 1,
                  html_url: `https://example.test/${index + 1}`,
                  body: 'unrelated',
                }))
              : [
                  {
                    number: 217,
                    html_url: 'https://example.test/217',
                    body: marker,
                  },
                ],
          ),
          { status: 200 },
        );
      },
    );

    await expect(
      service.createIssue({
        title: 'Find an older marker',
        body: 'Do not duplicate an issue beyond the first page.',
        labels: ['needs-triage', 'discord-request'],
        idempotencyKey: 'older-draft',
      }),
    ).resolves.toMatchObject({ number: 217 });
    expect(postCount).toBe(0);
  });
});
