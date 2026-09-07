import { GitHubServiceError } from './github-service.js';

export const GITHUB_ISSUE_TITLE_MAX = 256;

export interface GitHubIssueDraft {
  readonly title: string;
  readonly body: string;
}

export interface GitHubIssueCreateResult {
  readonly number: number;
  readonly url: string;
}

export interface GitHubIssueCreateService {
  createIssue(draft: GitHubIssueDraft): Promise<GitHubIssueCreateResult>;
}

const isConfiguredIssueUrl = (
  url: string,
  owner: string,
  repo: string,
): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
    return false;
  }
  const expected = `/${owner}/${repo}/issues/`.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (!path.startsWith(expected)) {
    return false;
  }
  return (
    /^\d+$/.test(path.slice(expected.length)) &&
    parsed.search === '' &&
    parsed.hash === ''
  );
};

export class HttpGitHubIssueCreateService implements GitHubIssueCreateService {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
    private readonly timeoutMs = 8_000,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async createIssue(draft: GitHubIssueDraft): Promise<GitHubIssueCreateResult> {
    if (this.token.trim() === '') {
      throw new GitHubServiceError(
        'forbidden',
        'GitHub issue creation is not configured.',
      );
    }
    const title = draft.title.trim().slice(0, GITHUB_ISSUE_TITLE_MAX);
    const body = draft.body.trim();
    if (title === '' || body === '') {
      throw new GitHubServiceError(
        'unavailable',
        'GitHub issue creation received an empty draft.',
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(
        `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/issues`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json',
            'user-agent': 'Jarvis-Discord-Bot',
          },
          body: JSON.stringify({ title, body }),
        },
      );
      if (response.status === 401 || response.status === 403) {
        throw new GitHubServiceError(
          'forbidden',
          'GitHub issue creation is unavailable.',
        );
      }
      if (!response.ok) {
        throw new GitHubServiceError(
          'unavailable',
          'GitHub is temporarily unavailable.',
        );
      }
      const data = (await response.json()) as {
        number?: unknown;
        html_url?: unknown;
      };
      if (
        !Number.isSafeInteger(data.number) ||
        typeof data.html_url !== 'string' ||
        !isConfiguredIssueUrl(data.html_url, this.owner, this.repo)
      ) {
        throw new GitHubServiceError(
          'unavailable',
          'GitHub returned an invalid response.',
        );
      }
      return { number: data.number as number, url: data.html_url };
    } catch (error) {
      if (error instanceof GitHubServiceError) throw error;
      throw new GitHubServiceError(
        'unavailable',
        'GitHub is temporarily unavailable.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
