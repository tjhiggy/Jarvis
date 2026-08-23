export interface AdminConsoleWorkflowDefinition {
  readonly id: string;
  readonly label: string;
}

export const adminConsoleWorkflows = [
  {
    id: 'overview-provider-database-health',
    label: 'Overview provider and database health',
  },
  { id: 'overview-health', label: 'Overview health banner' },
  { id: 'integration-readiness', label: 'Integrations readiness' },
  { id: 'scheduler-status', label: 'Operations scheduler status' },
  {
    id: 'knowledge-readiness',
    label: 'Community Intelligence knowledge readiness',
  },
  { id: 'member-statistics', label: 'Community aggregate opt-in metrics' },
  { id: 'image-readiness', label: 'Community Intelligence image readiness' },
  { id: 'scheduler-health', label: 'Operations scheduler health' },
  { id: 'sleeper-readiness', label: 'Integrations Sleeper readiness' },
  {
    id: 'introduction-profile-totals',
    label: 'Community introductions and profiles totals',
  },
  { id: 'suggestion-totals', label: 'Community suggestion totals' },
  {
    id: 'transmission-preview-send',
    label: 'Broadcasts new transmission preview and send',
  },
  { id: 'github-readiness', label: 'Integrations GitHub readiness' },
  { id: 'event-totals', label: 'Community event totals' },
  { id: 'event-scheduler', label: 'Operations event scheduler' },
  {
    id: 'recap-controls',
    label: 'Broadcasts recap preview and pause controls',
  },
  { id: 'trivia-totals', label: 'Community trivia totals' },
  { id: 'trivia-controls', label: 'Broadcasts trivia controls' },
  { id: 'engagement-metrics', label: 'Overview engagement metrics' },
  { id: 'feature-flags', label: 'Settings feature flags' },
  { id: 'scheduler-controls', label: 'Operations scheduler pause and resume' },
  {
    id: 'participation-metrics',
    label: 'Community aggregate participation metrics',
  },
  { id: 'birthday-totals', label: 'Community birthday totals' },
  { id: 'role-menu-readiness', label: 'Settings role-menu readiness' },
  { id: 'rss-controls', label: 'Broadcasts RSS preview and pause controls' },
  { id: 'rss-readiness', label: 'Integrations RSS readiness' },
] as const satisfies readonly AdminConsoleWorkflowDefinition[];

export const adminConsoleWorkflowManifest = (): string =>
  adminConsoleWorkflows.map(({ id }) => id).join(' ');
