export interface GitHubRepositorySummary {
  readonly fullName: string;
  readonly description: string | null;
  readonly stars: number;
  readonly openIssues: number;
  readonly defaultBranch: string;
  readonly url: string;
}
export interface GitHubWorkItem {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly author: string;
  readonly url: string;
  readonly updatedAt: string;
  readonly kind: 'issue' | 'pull-request';
}
export interface GitHubReadOnlyService {
  repository(): Promise<GitHubRepositorySummary>;
  issue(number: number): Promise<GitHubWorkItem>;
  pullRequest(number: number): Promise<GitHubWorkItem>;
}

export class GitHubServiceError extends Error {
  constructor(
    public readonly code: 'unavailable' | 'not-found' | 'forbidden',
    message: string,
  ) {
    super(message);
    this.name = 'GitHubServiceError';
  }
}

export class HttpGitHubReadOnlyService implements GitHubReadOnlyService {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token = '',
    private readonly timeoutMs = 8_000,
  ) {}
  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`https://api.github.com${path}`, {
        signal: controller.signal,
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'Jarvis-Discord-Bot',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
      });
      if (response.status === 404)
        throw new GitHubServiceError('not-found', 'GitHub item not found.');
      if (response.status === 401 || response.status === 403)
        throw new GitHubServiceError(
          'forbidden',
          'GitHub access is unavailable.',
        );
      if (!response.ok)
        throw new GitHubServiceError(
          'unavailable',
          'GitHub is temporarily unavailable.',
        );
      return (await response.json()) as T;
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
  async repository(): Promise<GitHubRepositorySummary> {
    const d = await this.get<any>(
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`,
    );
    return {
      fullName: d.full_name,
      description: d.description ?? null,
      stars: d.stargazers_count,
      openIssues: d.open_issues_count,
      defaultBranch: d.default_branch,
      url: d.html_url,
    };
  }
  private async work(
    path: string,
    kind: 'issue' | 'pull-request',
  ): Promise<GitHubWorkItem> {
    const d = await this.get<any>(path);
    return {
      number: d.number,
      title: d.title,
      state: d.state,
      author: d.user?.login ?? 'unknown',
      url: d.html_url,
      updatedAt: d.updated_at,
      kind,
    };
  }
  issue(number: number) {
    return this.work(
      `/repos/${this.owner}/${this.repo}/issues/${number}`,
      'issue',
    );
  }
  pullRequest(number: number) {
    return this.work(
      `/repos/${this.owner}/${this.repo}/pulls/${number}`,
      'pull-request',
    );
  }
}
