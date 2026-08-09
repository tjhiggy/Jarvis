import { describe, expect, it, vi } from 'vitest';
import { GitHubServiceError, HttpGitHubReadOnlyService } from '../src/github/github-service.js';

describe('GitHub read-only service', () => {
  it('limits requests to the configured repository and maps metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ full_name:'tjhiggy/Jarvis', description:'bot', stargazers_count:2, open_issues_count:3, default_branch:'main', html_url:'https://github.com/tjhiggy/Jarvis' }), { status:200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new HttpGitHubReadOnlyService('tjhiggy','Jarvis','secret');
    await expect(service.repository()).resolves.toMatchObject({ fullName:'tjhiggy/Jarvis', stars:2 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/tjhiggy/Jarvis');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: expect.objectContaining({ authorization:'Bearer secret' }) });
  });
  it('maps not found without exposing response details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private details', { status:404 })));
    await expect(new HttpGitHubReadOnlyService('owner','repo').issue(99)).rejects.toMatchObject({ code:'not-found' });
  });
  it('maps timeout and transport errors safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network secret')));
    await expect(new HttpGitHubReadOnlyService('owner','repo').pullRequest(1)).rejects.toBeInstanceOf(GitHubServiceError);
  });
});
