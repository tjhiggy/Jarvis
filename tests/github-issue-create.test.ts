import { describe, expect, it } from 'vitest';
import { GitHubServiceError } from '../src/github/github-service.js';
import {
  GITHUB_ISSUE_TITLE_MAX,
  HttpGitHubIssueCreateService,
} from '../src/github/issue-create.js';

const validDraft = {
  title: 'Refresh the FAQ',
  body: '## What\nRefresh the FAQ',
};

const createdIssue = {
  number: 401,
  html_url: 'https://github.com/tjhiggy/Jarvis/issues/401',
};

const issueService = (
  fetcher: typeof fetch,
  token = 'repo-bot-token',
): HttpGitHubIssueCreateService =>
  new HttpGitHubIssueCreateService('tjhiggy', 'Jarvis', token, 8_000, fetcher);

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
      issueService(
        async () => new Response('private details', { status: 403 }),
      ).createIssue(validDraft),
    ).rejects.toMatchObject({ code: 'forbidden' });

    await expect(
      issueService(async () => {
        throw new Error('network secret');
      }).createIssue(validDraft),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'unavailable',
    });
  });

  it('fails closed on a blank token without calling GitHub', async () => {
    let called = false;
    await expect(
      issueService(async () => {
        called = true;
        return new Response(JSON.stringify(createdIssue), { status: 201 });
      }, '   ').createIssue(validDraft),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'forbidden',
    });
    expect(called).toBe(false);
  });

  it.each([
    ['empty title', { title: '   ', body: validDraft.body }],
    ['empty body', { title: validDraft.title, body: '\n' }],
  ])('does not call GitHub for an %s draft', async (_name, draft) => {
    let called = false;
    await expect(
      issueService(async () => {
        called = true;
        return new Response(JSON.stringify(createdIssue), { status: 201 });
      }).createIssue(draft),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'unavailable',
    });
    expect(called).toBe(false);
  });

  it('truncates titles to the GitHub bound before posting', async () => {
    let requestBody = '';
    await issueService(async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify(createdIssue), { status: 201 });
    }).createIssue({
      title: `${'A'.repeat(GITHUB_ISSUE_TITLE_MAX)} extra`,
      body: validDraft.body,
    });

    expect(JSON.parse(requestBody).title).toBe(
      'A'.repeat(GITHUB_ISSUE_TITLE_MAX),
    );
    expect(JSON.parse(requestBody).title).toHaveLength(GITHUB_ISSUE_TITLE_MAX);
  });

  it.each([
    ['non-HTTPS', 'http://github.com/tjhiggy/Jarvis/issues/401'],
    ['www host', 'https://www.github.com/tjhiggy/Jarvis/issues/401'],
    ['different owner', 'https://github.com/evil/Jarvis/issues/401'],
    ['different repo', 'https://github.com/tjhiggy/other/issues/401'],
    ['query string', 'https://github.com/tjhiggy/Jarvis/issues/401?token=1'],
    ['hash', 'https://github.com/tjhiggy/Jarvis/issues/401#note'],
    ['trailing slash', 'https://github.com/tjhiggy/Jarvis/issues/401/'],
    ['extra path', 'https://github.com/tjhiggy/Jarvis/issues/401/comments'],
    ['pull request path', 'https://github.com/tjhiggy/Jarvis/pulls/401'],
    ['unparseable', 'not-a-url'],
  ])('rejects a %s issue URL', async (_kind, html_url) => {
    await expect(
      issueService(
        async () =>
          new Response(JSON.stringify({ number: 401, html_url }), {
            status: 201,
          }),
      ).createIssue(validDraft),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'unavailable',
      message: 'GitHub returned an invalid response.',
    });
  });

  it.each([
    ['missing number', { html_url: createdIssue.html_url }],
    ['non-integer number', { number: 401.5, html_url: createdIssue.html_url }],
    ['string number', { number: '401', html_url: createdIssue.html_url }],
    ['missing html_url', { number: 401 }],
    ['non-string html_url', { number: 401, html_url: 12 }],
  ])('rejects an invalid GitHub payload (%s)', async (_kind, payload) => {
    await expect(
      issueService(
        async () => new Response(JSON.stringify(payload), { status: 201 }),
      ).createIssue(validDraft),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'unavailable',
    });
  });

  it('maps 401 as forbidden and other HTTP failures as unavailable without leaking bodies', async () => {
    await expect(
      issueService(
        async () => new Response('token leaked', { status: 401 }),
      ).createIssue(validDraft),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'GitHub issue creation is unavailable.',
    });

    try {
      await issueService(
        async () => new Response('stack trace secret', { status: 502 }),
      ).createIssue(validDraft);
      throw new Error('expected GitHubServiceError');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'GitHubServiceError',
        code: 'unavailable',
        message: 'GitHub is temporarily unavailable.',
      });
      expect(String(error)).not.toMatch(/stack trace secret/i);
    }
  });

  it('maps a malformed JSON body as unavailable without exposing parse details', async () => {
    await expect(
      issueService(
        async () => new Response('{not-json', { status: 201 }),
      ).createIssue(validDraft),
    ).rejects.toMatchObject({
      name: 'GitHubServiceError',
      code: 'unavailable',
      message: 'GitHub is temporarily unavailable.',
    });
  });
});
