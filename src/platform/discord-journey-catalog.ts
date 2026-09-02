import type {
  DiscordJourney,
  DiscordJourneyEvidence,
  DiscordJourneyOutcome,
} from './discord-journey-verification.js';

export const publishedDiscordCommandNames = [
  'ask',
  'search',
  'forget',
  'help',
  'status',
  'faq',
  'knowledge',
  'catch-me-up',
  'channel-summary',
  'server-search',
  'my-stats',
  'image',
  'reminder',
  'fantasy',
  'poll',
  'poll-close',
  'introduce',
  'introduction',
  'suggest',
  'post',
  'github',
  'suggestion',
  'event',
  'game-night',
  'lfg',
  'recap',
  'request',
  'trivia',
  'engagement',
  'daily',
  'streak',
  'birthday',
  'profile',
  'roles',
  'rss',
  'notifications',
  'config',
] as const;

type PublishedCommandName = (typeof publishedDiscordCommandNames)[number];

const routeEvidence: Record<PublishedCommandName, string> = {
  ask: 'tests/handlers.test.ts',
  search: 'tests/handlers.test.ts',
  forget: 'tests/handlers.test.ts',
  help: 'tests/handlers.test.ts',
  status: 'tests/handlers.test.ts',
  faq: 'tests/handlers.test.ts',
  knowledge: 'tests/approved-knowledge.test.ts',
  'catch-me-up': 'tests/activity.test.ts',
  'channel-summary': 'tests/channel-summary.test.ts',
  'server-search': 'tests/server-search.test.ts',
  'my-stats': 'tests/member-statistics.test.ts',
  image: 'tests/image-generation.test.ts',
  reminder: 'tests/reminder-service.test.ts',
  fantasy: 'tests/sleeper/sleeper-service.test.ts',
  poll: 'tests/poll-controller.test.ts',
  'poll-close': 'tests/poll-controller.test.ts',
  introduce: 'tests/introduction-command.test.ts',
  introduction: 'tests/introduction-command.test.ts',
  suggest: 'tests/suggestion-command.test.ts',
  post: 'tests/delegated-posts.test.ts',
  github: 'tests/github-service.test.ts',
  suggestion: 'tests/suggestion-command.test.ts',
  event: 'tests/event-command.test.ts',
  'game-night': 'tests/game-night.test.ts',
  lfg: 'tests/looking-for-group.test.ts',
  recap: 'tests/recap-command.test.ts',
  request: 'tests/request-command.test.ts',
  trivia: 'tests/entertainment.test.ts',
  engagement: 'tests/engagement-control.test.ts',
  daily: 'tests/daily-reward.test.ts',
  streak: 'tests/participation-streaks.test.ts',
  birthday: 'tests/birthdays.test.ts',
  profile: 'tests/member-profile-command.test.ts',
  roles: 'tests/role-menus.test.ts',
  rss: 'tests/rss-command.test.ts',
  notifications: 'tests/notification-command.test.ts',
  config: 'tests/config.test.ts',
};

const configurationDependent = new Set<PublishedCommandName>([
  'ask',
  'search',
  'image',
  'fantasy',
  'github',
  'rss',
]);
const publicCommands = new Set<PublishedCommandName>([
  'poll',
  'poll-close',
  'introduce',
  'suggest',
  'post',
  'request',
  'event',
  'game-night',
  'lfg',
  'trivia',
  'daily',
  'roles',
]);
const mixedCommands = new Set<PublishedCommandName>([
  'reminder',
  'introduction',
  'suggestion',
  'recap',
  'birthday',
  'profile',
  'notifications',
]);

function commandEvidence(route: string): DiscordJourneyEvidence {
  return {
    registration: 'tests/register-commands.test.ts',
    routing: route,
    visibility: route,
    state: route,
    permission: 'tests/command-permissions.test.ts',
  };
}

function commandJourney(command: PublishedCommandName): DiscordJourney {
  const outcome: DiscordJourneyOutcome = configurationDependent.has(command)
    ? 'configuration-dependent'
    : 'manual-required';
  return {
    id: `command-${command}`,
    kind: 'command',
    command,
    entryPoint: `/${command}`,
    state:
      outcome === 'configuration-dependent'
        ? 'Supporting regressions exercise unavailable behavior; provider-backed success and exact command state require deployed confirmation.'
        : 'Supporting regressions exercise related behavior but are not exact named proof of every state for this command.',
    visibility: publicCommands.has(command)
      ? 'public'
      : mixedCommands.has(command)
        ? 'mixed'
        : 'private',
    configuration:
      outcome === 'configuration-dependent'
        ? 'Supporting synthetic regressions run with inherited credentials removed; deployed provider or channel configuration must be confirmed separately.'
        : 'Supporting synthetic regressions run with inherited credentials removed; they do not prove deployed configuration.',
    permission:
      'The referenced permission file is supporting regression coverage, not command-specific proof; confirm the documented member or administrator boundary manually.',
    evidence: commandEvidence(routeEvidence[command]),
    outcome,
    manualObligation:
      outcome === 'configuration-dependent'
        ? 'Confirm registration, routing, visibility, state, permissions, and the approved deployed dependency without recording credentials, production identifiers, or content.'
        : 'Confirm registration, routing, visibility, state, permissions, and mobile presentation during release smoke testing.',
  };
}

const crossCuttingEvidence = (route: string): DiscordJourneyEvidence => ({
  registration: 'tests/register-commands.test.ts',
  routing: route,
  visibility: route,
  state: route,
  permission: 'tests/command-permissions.test.ts',
});

export const discordJourneyCatalog: readonly DiscordJourney[] = [
  ...publishedDiscordCommandNames.map(commandJourney),
  {
    id: 'retired-feature-request-write-surface',
    kind: 'feature',
    entryPoint: 'Native GitHub Discussions and issue forms',
    state:
      'The retired Discord feature-request command is intentionally not registered or routed.',
    visibility: 'not-applicable',
    configuration:
      'GitHub-native intake owns feature requests; Jarvis has no GitHub-write configuration.',
    permission:
      'No Discord member or administrator can invoke a Jarvis GitHub-write journey.',
    evidence: crossCuttingEvidence('tests/register-commands.test.ts'),
    outcome: 'not-applicable',
    manualObligation:
      'Review GitHub-native intake guidance when repository workflows change.',
  },
  {
    id: 'feature-button-and-modal-interactions',
    kind: 'feature',
    entryPoint: 'Discord buttons and modals',
    state:
      'Preview, confirm, cancel, RSVP, moderation, and opt-in interactions preserve bounded state transitions.',
    visibility: 'mixed',
    configuration: 'Disposable interaction fixtures only.',
    permission:
      'Actor ownership and administrator boundaries are enforced before mutation.',
    evidence: crossCuttingEvidence('tests/preview-buttons.test.ts'),
    outcome: 'manual-required',
    manualObligation:
      'Confirm mobile button and modal layout during release smoke testing.',
  },
  {
    id: 'state-disabled-empty-retry',
    kind: 'state',
    entryPoint: 'All Discord journeys',
    state:
      'Disabled, unavailable, empty, duplicate, expired, and retry states remain actionable and do not claim success.',
    visibility: 'mixed',
    configuration: 'Synthetic disabled and missing-dependency fixtures.',
    permission:
      'Failure paths preserve the same authorization boundary as success paths.',
    evidence: crossCuttingEvidence('tests/engagement-safety.test.ts'),
    outcome: 'manual-required',
    manualObligation:
      'Confirm representative disabled, unavailable, empty, duplicate, expired, and retry states against the deployed command surface.',
  },
  {
    id: 'configuration-live-registration-and-destinations',
    kind: 'configuration',
    entryPoint: 'Deployed Discord application',
    state:
      'Automated tests verify payload construction, not the live Discord registration or destination configuration.',
    visibility: 'not-applicable',
    configuration:
      'Approved application registration, server roles, allowlisted channels, and provider settings are required.',
    permission:
      'OAuth scopes and deployed role hierarchy require operator confirmation.',
    evidence: crossCuttingEvidence('tests/register-commands.test.ts'),
    outcome: 'configuration-dependent',
    manualObligation:
      'Confirm live command registration, role hierarchy, OAuth scopes, and allowlisted destinations without retaining production identifiers.',
  },
  {
    id: 'manual-mobile-rendering-and-delivery',
    kind: 'manual',
    entryPoint: 'Discord desktop and mobile clients',
    state:
      'Rendered cards, ephemeral notices, buttons, and public delivery cannot be proven by headless unit tests.',
    visibility: 'mixed',
    configuration: 'Use an approved test channel and synthetic message text.',
    permission:
      'Use member and administrator test personas appropriate to each journey.',
    evidence: crossCuttingEvidence('tests/engagement-ui.test.ts'),
    outcome: 'manual-required',
    manualObligation:
      'Smoke test representative private, public, button, modal, success, and failure journeys on desktop and mobile.',
  },
  {
    id: 'safety-content-secrets-identifiers',
    kind: 'safety',
    entryPoint: 'Discord logging, metrics, and verification artifacts',
    state:
      'Receipts and operational evidence retain bounded aggregate metadata only.',
    visibility: 'not-applicable',
    configuration:
      'Inherited Discord and provider credentials are removed from focused child processes; this does not sandbox filesystem or network access.',
    permission:
      'The fixed receipt schema and redaction checks bound persisted QA output; supporting tests do not prove every operational surface.',
    evidence: crossCuttingEvidence('tests/logger.test.ts'),
    outcome: 'manual-required',
    manualObligation:
      'Review deployed logs, metrics, and artifacts for bounded aggregate metadata without recording production content or identifiers.',
  },
  {
    id: 'safety-sanitized-verification-receipt',
    kind: 'safety',
    entryPoint: 'Local QA artifact',
    state:
      'The fixed receipt schema stores aggregate execution results only and proves a runtime redaction marker was removed.',
    visibility: 'not-applicable',
    configuration:
      'The receipt is written under the ignored QA artifact directory.',
    permission:
      'The verifier receives only an allowlisted disposable process environment.',
    evidence: crossCuttingEvidence('tests/discord-journey-receipt.test.ts'),
    outcome: 'manual-required',
    manualObligation:
      'Inspect the generated receipt schema and redaction result; file-level execution is supporting evidence, not named assertion proof.',
  },
];
