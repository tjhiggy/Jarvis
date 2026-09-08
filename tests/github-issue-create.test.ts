import { describe, expect, it } from 'vitest';
import { GitHubServiceError } from '../src/github/github-service.js';
import {
  GITHUB_ISSUE_TITLE_MAX,
  HttpGitHubIssueCreateService,
} from '../src/github/issue-create.js';

describe('GitHub issue create service', () => {
  it('posts only to the configured repository with the integration token', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const service = new HttpGitHubIssueCreateService(
      'tjhiggy',
      'Jarvis',
      'repo-bot-token',
      8_000,
      async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(
          JSON.stringify({
            number: 401,
            html_url: 'https://github.com/tjhiggy/Jarvis/issues/401',
          }),
          { status: 201 },
        );
      },
    );

    await expect(
      service.createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).resolves.toEqual({
      number: 401,
      url: 'https://github.com/tjhiggy/Jarvis/issues/401',
    });
    expect(requestUrl).toBe(
      'https://api.github.com/repos/tjhiggy/Jarvis/issues',
    );
    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.headers).toMatchObject({
      authorization: 'Bearer repo-bot-token',
    });
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      title: 'Refresh the FAQ',
      body: '## What\nRefresh the FAQ',
    });
  });

  it('fails closed without a token and does not call GitHub', async () => {
    let called = false;
    const service = new HttpGitHubIssueCreateService(
      'tjhiggy',
      'Jarvis',
      '',
      8_000,
      async () => {
        called = true;
        return new Response('{}', { status: 201 });
      },
    );

    await expect(
      service.createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'forbidden',
    });
    expect(called).toBe(false);
  });

  it('fails closed for a blank token or empty title or body without calling GitHub', async () => {
    let called = false;
    const fetcher = async () => {
      called = true;
      return new Response('{}', { status: 201 });
    };

    await expect(
      new HttpGitHubIssueCreateService(
        'tjhiggy',
        'Jarvis',
        '   ',
        8_000,
        fetcher,
      ).createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    await expect(
      new HttpGitHubIssueCreateService(
        'tjhiggy',
        'Jarvis',
        'repo-bot-token',
        8_000,
        fetcher,
      ).createIssue({ title: '   ', body: '## What\nRefresh the FAQ' }),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'unavailable',
    });

    await expect(
      new HttpGitHubIssueCreateService(
        'tjhiggy',
        'Jarvis',
        'repo-bot-token',
        8_000,
        fetcher,
      ).createIssue({ title: 'Refresh the FAQ', body: '\n  ' }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(called).toBe(false);
  });

  it('truncates titles to 256 characters before the GitHub request', async () => {
    let requestBody = '';
    const service = new HttpGitHubIssueCreateService(
      'tjhiggy',
      'Jarvis',
      'repo-bot-token',
      8_000,
      async (_input, init) => {
        requestBody = String(init?.body);
        return new Response(
          JSON.stringify({
            number: 401,
            html_url: 'https://github.com/tjhiggy/Jarvis/issues/401',
          }),
          { status: 201 },
        );
      },
    );
    const title = `Q${'u'.repeat(300)}`;

    await service.createIssue({
      title,
      body: '## What\nRefresh the FAQ',
    });

    expect(JSON.parse(requestBody)).toEqual({
      title: title.slice(0, GITHUB_ISSUE_TITLE_MAX),
      body: '## What\nRefresh the FAQ',
    });
    expect(JSON.parse(requestBody).title).toHaveLength(GITHUB_ISSUE_TITLE_MAX);
  });

  it.each([
    ['http scheme', 'http://github.com/tjhiggy/Jarvis/issues/401'],
    ['www host', 'https://www.github.com/tjhiggy/Jarvis/issues/401'],
    ['other repository', 'https://github.com/other/Jarvis/issues/401'],
    ['query string', 'https://github.com/tjhiggy/Jarvis/issues/401?x=1'],
    ['hash', 'https://github.com/tjhiggy/Jarvis/issues/401#discussion'],
    ['trailing slash', 'https://github.com/tjhiggy/Jarvis/issues/401/'],
    ['extra path', 'https://github.com/tjhiggy/Jarvis/issues/401/events'],
    ['pull request path', 'https://github.com/tjhiggy/Jarvis/pull/401'],
  ])('rejects a response URL with %s', async (_name, htmlUrl) => {
    const service = new HttpGitHubIssueCreateService(
      'tjhiggy',
      'Jarvis',
      'repo-bot-token',
      8_000,
      async () =>
        new Response(JSON.stringify({ number: 401, html_url: htmlUrl }), {
          status: 201,
        }),
    );

    await expect(
      service.createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'unavailable',
      message: 'GitHub returned an invalid response.',
    });
  });

  it.each([
    [
      'missing number',
      { html_url: 'https://github.com/tjhiggy/Jarvis/issues/401' },
    ],
    [
      'non-integer number',
      {
        number: '401',
        html_url: 'https://github.com/tjhiggy/Jarvis/issues/401',
      },
    ],
    ['missing url', { number: 401 }],
    ['non-string url', { number: 401, html_url: 401 }],
  ])('rejects an invalid payload with %s', async (_name, payload) => {
    const service = new HttpGitHubIssueCreateService(
      'tjhiggy',
      'Jarvis',
      'repo-bot-token',
      8_000,
      async () => new Response(JSON.stringify(payload), { status: 201 }),
    );

    await expect(
      service.createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      message: 'GitHub returned an invalid response.',
    });
  });

  it('rejects a response URL that is not an issue in the configured repository', async () => {
    const service = new HttpGitHubIssueCreateService(
      'tjhiggy',
      'Jarvis',
      'repo-bot-token',
      8_000,
      async () =>
        new Response(
          JSON.stringify({
            number: 401,
            html_url: 'https://evil.example/issues/401',
          }),
          { status: 201 },
        ),
    );

    await expect(
      service.createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toBeInstanceOf(GitHubServiceError);
  });

  it('maps unauthorized and transport failures without exposing response details', async () => {
    await expect(
      new HttpGitHubIssueCreateService(
        'tjhiggy',
        'Jarvis',
        'repo-bot-token',
        8_000,
        async () => new Response('private details', { status: 403 }),
      ).createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    await expect(
      new HttpGitHubIssueCreateService(
        'tjhiggy',
        'Jarvis',
        'repo-bot-token',
        8_000,
        async () => {
          throw new Error('network secret');
        },
      ).createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'unavailable',
    });

    await expect(
      new HttpGitHubIssueCreateService(
        'tjhiggy',
        'Jarvis',
        'repo-bot-token',
        8_000,
        async () => new Response('private details', { status: 401 }),
      ).createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });

    await expect(
      new HttpGitHubIssueCreateService(
        'tjhiggy',
        'Jarvis',
        'repo-bot-token',
        8_000,
        async () => new Response('upstream stack', { status: 502 }),
      ).createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      message: 'GitHub is temporarily unavailable.',
    });

    await expect(
      new HttpGitHubIssueCreateService(
        'tjhiggy',
        'Jarvis',
        'repo-bot-token',
        8_000,
        async () => new Response('not-json', { status: 201 }),
      ).createIssue({
        title: 'Refresh the FAQ',
        body: '## What\nRefresh the FAQ',
      }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      message: 'GitHub is temporarily unavailable.',
    });
  });
});
