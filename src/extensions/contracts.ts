/**
 * Deliberately inert extension shapes. These are declarations for future,
 * operator-approved read-only integrations, not implementations or tools.
 */
export type DisabledExtensionName =
  | 'github-read-only'
  | 'mcp'
  | 'repository-context'
  | 'pull-request-summaries'
  | 'recaps'
  | 'gaming-scores'
  | 'images'
  | 'admin-authorization';

export interface DisabledExtensionContract {
  readonly name: DisabledExtensionName;
  readonly enabled: false;
  readonly reason: 'operator approval required';
}

export interface GitHubReadOnlyContract extends DisabledExtensionContract {
  readonly name: 'github-read-only';
  getRepositorySummary(
    repository: string,
  ): Promise<Readonly<{ summary: string }>>;
}

export interface McpContract extends DisabledExtensionContract {
  readonly name: 'mcp';
  getContext(subject: string): Promise<Readonly<{ context: string }>>;
}

export interface RepositoryContextContract extends DisabledExtensionContract {
  readonly name: 'repository-context';
  getContext(repository: string): Promise<Readonly<{ context: string }>>;
}

export interface PullRequestSummariesContract extends DisabledExtensionContract {
  readonly name: 'pull-request-summaries';
  getSummary(pullRequest: number): Promise<Readonly<{ summary: string }>>;
}

export interface RecapsContract extends DisabledExtensionContract {
  readonly name: 'recaps';
  getRecap(subject: string): Promise<Readonly<{ recap: string }>>;
}

export interface GamingScoresContract extends DisabledExtensionContract {
  readonly name: 'gaming-scores';
  getScoreboard(game: string): Promise<Readonly<{ scoreboard: string }>>;
}

export interface ImagesContract extends DisabledExtensionContract {
  readonly name: 'images';
  getImageDescription(
    imageId: string,
  ): Promise<Readonly<{ description: string }>>;
}

/** This contract cannot grant Discord permissions or server authority. */
export interface AdminAuthorizationContract extends DisabledExtensionContract {
  readonly name: 'admin-authorization';
}
