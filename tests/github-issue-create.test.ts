import { describe, expect, it } from 'vitest';
import { GitHubServiceError } from '../src/github/github-service.js';
import { HttpGitHubIssueCreateService } from '../src/github/issue-create.js';

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
  });
});
