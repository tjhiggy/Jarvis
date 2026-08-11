import { randomUUID } from 'node:crypto';
import { GitHubServiceError } from './github-service.js';

export interface GitHubIssueCreateRequest {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly ['needs-triage', 'discord-request'];
  readonly idempotencyKey: string;
}

export interface GitHubIssueCreateResult {
  readonly number: number;
  readonly url: string;
}

export interface GitHubIssueCreateService {
  createIssue(
    request: GitHubIssueCreateRequest,
  ): Promise<GitHubIssueCreateResult>;
}

export class HttpGitHubIssueCreateService implements GitHubIssueCreateService {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
    private readonly timeoutMs = 8_000,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async createIssue(
    request: GitHubIssueCreateRequest,
  ): Promise<GitHubIssueCreateResult> {
    if (this.token.trim() === '') {
      throw new GitHubServiceError(
        'forbidden',
        'GitHub issue creation is not configured.',
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const marker = `<!-- jarvis-feature-request:${request.idempotencyKey} -->`;
      for (let page = 1; ; page += 1) {
        const existingResponse = await this.fetcher(
          `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/issues?state=all&per_page=100&page=${page}`,
          {
            signal: controller.signal,
            headers: {
              accept: 'application/vnd.github+json',
              authorization: `Bearer ${this.token}`,
              'user-agent': 'Jarvis-Discord-Bot',
            },
          },
        );
        if (!existingResponse.ok) {
          if (
            existingResponse.status === 401 ||
            existingResponse.status === 403
          ) {
            throw new GitHubServiceError(
              'forbidden',
              'GitHub issue creation is unavailable.',
            );
          }
          throw new GitHubServiceError(
            'unavailable',
            'GitHub issue reconciliation is temporarily unavailable.',
          );
        }
        const existing = (await existingResponse.json()) as unknown;
        if (!Array.isArray(existing)) {
          throw new GitHubServiceError(
            'unavailable',
            'GitHub issue reconciliation returned an invalid response.',
          );
        }
        const match = existing.find(
          (
            issue,
          ): issue is { number: number; html_url: string; body: string } =>
            typeof issue === 'object' &&
            issue !== null &&
            Number.isSafeInteger((issue as { number?: unknown }).number) &&
            typeof (issue as { html_url?: unknown }).html_url === 'string' &&
            typeof (issue as { body?: unknown }).body === 'string' &&
            (issue as { body: string }).body.includes(marker),
        );
        if (match) return { number: match.number, url: match.html_url };
        if (existing.length < 100) break;
      }
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
          body: JSON.stringify({
            title: request.title,
            body: `${request.body}\n\n${marker}`,
            labels: request.labels,
          }),
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
        typeof data.html_url !== 'string'
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

interface FeatureRequestDraft {
  readonly id: string;
  readonly serverId: string;
  readonly channelId: string;
  readonly ownerId: string;
  readonly title: string;
  readonly description: string;
  readonly createdAt: Date;
}

export class FeatureRequestService {
  private readonly drafts = new Map<string, FeatureRequestDraft>();
  private readonly confirming = new Set<string>();
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      readonly github: GitHubIssueCreateService;
      readonly now?: () => Date;
    },
  ) {
    this.now = options.now ?? (() => new Date());
  }

  preview(input: {
    readonly serverId: string;
    readonly channelId: string;
    readonly ownerId: string;
    readonly title: string;
    readonly description: string;
  }): FeatureRequestDraft {
    const title = input.title.trim();
    const description = input.description.trim();
    if (title.length < 5 || title.length > 120)
      throw new Error('Invalid title.');
    if (description.length < 10 || description.length > 1_500)
      throw new Error('Invalid description.');
    this.cleanup();
    for (const draft of this.drafts.values()) {
      if (
        draft.serverId === input.serverId &&
        draft.channelId === input.channelId &&
        draft.ownerId === input.ownerId &&
        draft.title === title &&
        draft.description === description
      ) {
        return draft;
      }
    }
    const id = randomUUID();
    const draft = { ...input, id, title, description, createdAt: this.now() };
    this.drafts.set(id, draft);
    return draft;
  }

  cancel(input: {
    readonly draftId: string;
    readonly serverId: string;
    readonly channelId: string;
    readonly ownerId: string;
  }): boolean {
    this.cleanup();
    const draft = this.ownedDraft(input);
    if (!draft || this.confirming.has(draft.id)) return false;
    return this.drafts.delete(draft.id);
  }

  async confirm(input: {
    readonly draftId: string;
    readonly serverId: string;
    readonly channelId: string;
    readonly ownerId: string;
  }): Promise<GitHubIssueCreateResult> {
    this.cleanup();
    const draft = this.ownedDraft(input);
    if (!draft || this.confirming.has(draft.id))
      throw new Error('Draft is unavailable.');
    this.confirming.add(draft.id);
    try {
      const result = await this.options.github.createIssue({
        title: draft.title,
        body: [
          '## Summary',
          draft.description,
          '',
          '## Intake metadata',
          `- Submitted from Discord server: \`${draft.serverId}\``,
          `- Channel or thread: \`${draft.channelId}\``,
          `- Requester: \`${draft.ownerId}\``,
          `- Submitted: ${draft.createdAt.toISOString()}`,
          '',
          '_Created by the bounded Jarvis Discord feature-request workflow._',
        ].join('\n'),
        labels: ['needs-triage', 'discord-request'],
        idempotencyKey: draft.id,
      });
      this.drafts.delete(draft.id);
      return result;
    } finally {
      this.confirming.delete(draft.id);
    }
  }

  private ownedDraft(input: {
    readonly draftId: string;
    readonly serverId: string;
    readonly channelId: string;
    readonly ownerId: string;
  }) {
    const draft = this.drafts.get(input.draftId);
    return draft?.serverId === input.serverId &&
      draft.channelId === input.channelId &&
      draft.ownerId === input.ownerId
      ? draft
      : undefined;
  }

  private cleanup(): void {
    const cutoff = this.now().getTime() - 15 * 60_000;
    for (const [id, draft] of this.drafts) {
      if (draft.createdAt.getTime() <= cutoff) this.drafts.delete(id);
    }
  }
}
