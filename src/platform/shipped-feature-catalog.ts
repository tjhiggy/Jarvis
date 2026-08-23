import type { FeatureVerificationRecord } from './feature-verification.js';

export const shippedFeatureCatalog = [
  {
    id: 'conversation-and-search',
    name: 'Conversation, help, and retained search',
    status: 'pass',
    ownerModule: 'src/services/conversation-service.ts',
    entryPoints: {
      discordCommands: [
        'ask',
        'search',
        'forget',
        'help',
        'catch-me-up',
        'channel-summary',
        'server-search',
      ],
      commandDeckWorkflows: ['overview-provider-database-health'],
    },
    audience: 'member',
    requiredConfiguration: [
      'AI_PROVIDER',
      'DATABASE_PATH',
      'ALLOWED_CHANNEL_IDS',
    ],
    permissionBoundary:
      'Member commands stay in allowed channels and retained search stays in the current channel or thread.',
    persistenceBehavior:
      'Conversation history is channel scoped, capped, and retention limited.',
    automatedEvidence: [
      'tests/conversation-service.test.ts',
      'tests/server-search.test.ts',
      'tests/channel-summary.test.ts',
    ],
    manualSmokeCases: [
      'Run /ask, /catch-me-up, and /server-search in the test channel, then run /forget and verify that context is cleared only there.',
    ],
  },
  {
    id: 'runtime-health-and-configuration',
    name: 'Runtime health and safe configuration',
    status: 'pass',
    ownerModule: 'src/config/runtime-identity.ts',
    entryPoints: {
      discordCommands: ['status', 'config'],
      commandDeckWorkflows: [
        'overview-health',
        'integration-readiness',
        'scheduler-status',
      ],
    },
    audience: 'mixed',
    requiredConfiguration: [
      'JARVIS_VERSION',
      'JARVIS_COMMIT_SHA',
      'JARVIS_BUILD_TIMESTAMP',
      'JARVIS_ENVIRONMENT',
    ],
    permissionBoundary:
      'Status is secret-free; detailed configuration is limited to configured administrators.',
    persistenceBehavior:
      'Health projections contain no message content or secrets.',
    automatedEvidence: [
      'tests/application.test.ts',
      'tests/config.test.ts',
      'tests/admin-console.test.ts',
    ],
    manualSmokeCases: [
      'Run /status and /config as an administrator and compare the safe identity and readiness values with the Command Deck Overview.',
    ],
    defectIssues: [285],
  },
  {
    id: 'approved-knowledge-and-faq',
    name: 'Approved knowledge and FAQ',
    status: 'pass',
    ownerModule: 'src/knowledge/approved-knowledge.ts',
    entryPoints: {
      discordCommands: ['faq', 'knowledge'],
      commandDeckWorkflows: ['knowledge-readiness'],
    },
    audience: 'mixed',
    requiredConfiguration: ['FAQ_CATALOG_PATH'],
    permissionBoundary:
      'Members can query approved sources; only configured administrators can approve or revoke sources.',
    persistenceBehavior: 'Only bounded approved-source metadata is retained.',
    automatedEvidence: [
      'tests/faq-catalog.test.ts',
      'tests/approved-knowledge.test.ts',
    ],
    manualSmokeCases: [
      'Run /faq and /knowledge query, then verify an administrator can list approved sources without exposing credentials.',
    ],
  },
  {
    id: 'private-member-statistics',
    name: 'Private member statistics',
    status: 'pass',
    ownerModule: 'src/community/member-statistics.ts',
    entryPoints: {
      discordCommands: ['my-stats'],
      commandDeckWorkflows: ['member-statistics'],
    },
    audience: 'member',
    requiredConfiguration: ['DATABASE_PATH'],
    permissionBoundary:
      'Member statistics are private and opt-in; the Deck receives aggregate totals only.',
    persistenceBehavior:
      'Only member opt-in state and bounded command counts are retained.',
    automatedEvidence: [
      'tests/instrumentation-member-statistics.test.ts',
      'tests/member-statistics.test.ts',
    ],
    manualSmokeCases: [
      'Enable /my-stats, invoke a command, verify the private count changes, then disable and verify retained counts are deleted.',
    ],
  },
  {
    id: 'administrator-image-generation',
    name: 'Administrator image generation',
    status: 'pass',
    ownerModule: 'src/images/image-generation.ts',
    entryPoints: {
      discordCommands: ['image'],
      commandDeckWorkflows: ['image-readiness'],
    },
    audience: 'administrator',
    requiredConfiguration: [
      'IMAGE_GENERATION_ENABLED',
      'IMAGE_GENERATION_CHANNEL_ID',
      'OPENAI_API_KEY',
    ],
    permissionBoundary:
      'Disabled by default and restricted to configured administrators in one approved channel.',
    persistenceBehavior:
      'Generated prompts and images are not added to Jarvis history.',
    automatedEvidence: ['tests/image-generation.test.ts'],
    manualSmokeCases: [
      'Enable the feature in a test deployment, run /image generate in the approved channel, and verify denial everywhere else.',
    ],
  },
  {
    id: 'reminders',
    name: 'Personal and shared reminders',
    status: 'pass',
    ownerModule: 'src/reminders/reminder-service.ts',
    entryPoints: {
      discordCommands: ['reminder'],
      commandDeckWorkflows: ['scheduler-health'],
    },
    audience: 'mixed',
    requiredConfiguration: ['DATABASE_PATH', 'ENGAGEMENT_ADMIN_ROLE_IDS'],
    permissionBoundary:
      'Members control only personal reminders; shared reminders require a configured administrator role.',
    persistenceBehavior:
      'Reminder content is retained until delivery, cancellation, or bounded cleanup.',
    automatedEvidence: [
      'tests/reminder-service.test.ts',
      'tests/reminder-scheduler.test.ts',
      'tests/reminder-delivery-gateway.test.ts',
    ],
    manualSmokeCases: [
      'Create, list, cancel, and deliver a personal reminder, then repeat the shared flow as an administrator in the test channel.',
    ],
  },
  {
    id: 'sleeper-fantasy-football',
    name: 'Sleeper Fantasy Football',
    status: 'pass',
    ownerModule: 'src/sleeper/sleeper-service.ts',
    entryPoints: {
      discordCommands: ['fantasy'],
      commandDeckWorkflows: ['sleeper-readiness'],
    },
    audience: 'member',
    requiredConfiguration: ['SLEEPER_LEAGUE_ID'],
    permissionBoundary: 'Provider access is read-only and league scoped.',
    persistenceBehavior:
      'Sleeper responses are not retained as member history.',
    automatedEvidence: ['tests/sleeper/sleeper-service.test.ts'],
    manualSmokeCases: [
      'Run /fantasy standings, matchup, and player against the configured league and verify provider failures remain actionable.',
    ],
  },
  {
    id: 'anonymous-polls',
    name: 'Anonymous polls',
    status: 'pass',
    ownerModule: 'src/polls/poll-service.ts',
    entryPoints: {
      discordCommands: ['poll', 'poll-close'],
      commandDeckWorkflows: [],
    },
    audience: 'administrator',
    requiredConfiguration: [
      'POLL_ADMIN_USER_IDS',
      'POLL_VOTER_SECRET',
      'POLL_RETENTION_DAYS',
    ],
    permissionBoundary:
      'Creation and early closure require configured poll administrators; voter identity is not exposed.',
    persistenceBehavior:
      'Encrypted voter tokens and bounded poll state are retained through expiry and cleanup.',
    automatedEvidence: [
      'tests/poll-service.test.ts',
      'tests/poll-storage.test.ts',
      'tests/poll-scheduler.test.ts',
    ],
    manualSmokeCases: [
      'Create a poll, vote from two accounts, verify duplicate voting is rejected, and close it early as an authorized administrator.',
    ],
  },
  {
    id: 'introductions-and-profiles',
    name: 'Introductions and member profiles',
    status: 'pass',
    ownerModule: 'src/engagement/introductions.ts',
    entryPoints: {
      discordCommands: ['introduce', 'introduction', 'profile'],
      commandDeckWorkflows: ['introduction-profile-totals'],
    },
    audience: 'member',
    requiredConfiguration: [
      'ENGAGEMENT_ENABLED',
      'ENGAGEMENT_INTRODUCTION_CHANNEL_ID',
    ],
    permissionBoundary:
      'Members control their own records; moderator views remain bounded and content is not exposed in Deck metrics.',
    persistenceBehavior:
      'Profiles and introductions obey retention, visibility, and user deletion controls.',
    automatedEvidence: [
      'tests/introduction-command.test.ts',
      'tests/member-profile-command.test.ts',
      'tests/member-profile-storage.test.ts',
    ],
    manualSmokeCases: [
      'Preview and confirm an introduction without copying an ID, then hide, show, edit, and delete the member profile.',
    ],
  },
  {
    id: 'community-suggestions',
    name: 'Community suggestions',
    status: 'pass',
    ownerModule: 'src/engagement/suggestions.ts',
    entryPoints: {
      discordCommands: ['suggest', 'suggestion'],
      commandDeckWorkflows: ['suggestion-totals'],
    },
    audience: 'mixed',
    requiredConfiguration: [
      'ENGAGEMENT_ENABLED',
      'ENGAGEMENT_SUGGESTION_CHANNEL_ID',
      'ENGAGEMENT_ADMIN_ROLE_IDS',
    ],
    permissionBoundary:
      'Members submit their own suggestions; status changes require configured administrators.',
    persistenceBehavior:
      'Suggestion state is retained with bounded content and explicit deletion.',
    automatedEvidence: [
      'tests/suggestion-command.test.ts',
      'tests/suggestion-moderation.test.ts',
    ],
    manualSmokeCases: [
      'Preview and confirm a suggestion, then acknowledge, defer, resolve, and archive it with an administrator account.',
    ],
  },
  {
    id: 'delegated-transmissions',
    name: 'Delegated and Command Deck transmissions',
    status: 'pass',
    ownerModule: 'src/engagement/delegated-posts.ts',
    entryPoints: {
      discordCommands: ['post'],
      commandDeckWorkflows: ['transmission-preview-send'],
    },
    audience: 'administrator',
    requiredConfiguration: [
      'ENGAGEMENT_ADMIN_ROLE_IDS',
      'ADMIN_CONSOLE_TOKEN',
      'ALLOWED_CHANNEL_IDS',
    ],
    permissionBoundary:
      'Only configured administrators can preview and send to allowlisted channels; uncontrolled mentions are rejected.',
    persistenceBehavior:
      'Drafts and delivery audit metadata are bounded; message content is excluded from logs.',
    automatedEvidence: [
      'tests/delegated-posts.test.ts',
      'tests/admin-console.test.ts',
    ],
    manualSmokeCases: [
      'Preview and send one transmission from the Command Deck to the test channel, then verify retry safety and the Discord fallback.',
    ],
  },
  {
    id: 'github-read-only',
    name: 'GitHub read-only integration',
    status: 'pass',
    ownerModule: 'src/github/github-service.ts',
    entryPoints: {
      discordCommands: ['github'],
      commandDeckWorkflows: ['github-readiness'],
    },
    audience: 'member',
    requiredConfiguration: ['GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_TOKEN'],
    permissionBoundary:
      'Repository, issue, and pull-request reads are fixed to one configured repository; Jarvis has no GitHub write authority.',
    persistenceBehavior:
      'GitHub response content is not retained by the integration.',
    automatedEvidence: ['tests/github-service.test.ts'],
    manualSmokeCases: [
      'Run each /github read-only subcommand and verify requests cannot target another repository or mutate GitHub state.',
    ],
    defectIssues: [284],
  },
  {
    id: 'events-and-matchmaking',
    name: 'Events, game nights, and crew matchmaking',
    status: 'pass',
    ownerModule: 'src/engagement/events.ts',
    entryPoints: {
      discordCommands: ['event', 'game-night', 'lfg'],
      commandDeckWorkflows: ['event-totals', 'event-scheduler'],
    },
    audience: 'mixed',
    requiredConfiguration: [
      'ENGAGEMENT_ENABLED',
      'ENGAGEMENT_EVENT_CHANNEL_ID',
      'ENGAGEMENT_ADMIN_ROLE_IDS',
    ],
    permissionBoundary:
      'Public participation is member driven; creation, cancellation, and scheduler controls require configured administrators.',
    persistenceBehavior:
      'Event and RSVP records are server scoped and retention limited; LFG posts create no admin record.',
    automatedEvidence: [
      'tests/event-command.test.ts',
      'tests/event-scheduler.test.ts',
      'tests/game-night.test.ts',
      'tests/looking-for-group.test.ts',
    ],
    manualSmokeCases: [
      'Create and cancel an event, record each RSVP choice, schedule a game night, and post one LFG request in the test channel.',
    ],
  },
  {
    id: 'weekly-recaps',
    name: 'Weekly engagement recaps',
    status: 'pass',
    ownerModule: 'src/engagement/recap.ts',
    entryPoints: {
      discordCommands: ['recap'],
      commandDeckWorkflows: ['recap-controls'],
    },
    audience: 'administrator',
    requiredConfiguration: [
      'ENGAGEMENT_RECAP_CHANNEL_ID',
      'ENGAGEMENT_RECAP_SCHEDULE',
      'ENGAGEMENT_RECAP_TIMEZONE',
    ],
    permissionBoundary:
      'Preview, enable, pause, and resume controls require configured administrators.',
    persistenceBehavior:
      'Recaps use aggregate activity only and omit private member content.',
    automatedEvidence: [
      'tests/recap-command.test.ts',
      'tests/recap-scheduler.test.ts',
      'tests/recap-privacy.test.ts',
    ],
    manualSmokeCases: [
      'Preview a recap, enable its schedule, verify a test delivery, then pause and resume it from the Deck.',
    ],
  },
  {
    id: 'trivia',
    name: 'Trivia rounds',
    status: 'pass',
    ownerModule: 'src/community/entertainment.ts',
    entryPoints: {
      discordCommands: ['trivia'],
      commandDeckWorkflows: ['trivia-totals', 'trivia-controls'],
    },
    audience: 'mixed',
    requiredConfiguration: [
      'ENGAGEMENT_ENABLED',
      'ENGAGEMENT_ACTIVITY_CHANNEL_ID',
    ],
    permissionBoundary:
      'Members opt in or out and answer once; starting rounds requires a configured administrator.',
    persistenceBehavior:
      'Only bounded answer correctness and participation data are retained through cleanup.',
    automatedEvidence: [
      'tests/entertainment.test.ts',
      'tests/engagement-ui.test.ts',
    ],
    manualSmokeCases: [
      'Start a trivia round, answer from two accounts, verify duplicate answers are rejected, and inspect the result delivery.',
    ],
  },
  {
    id: 'engagement-controls',
    name: 'Engagement controls and metrics',
    status: 'pass',
    ownerModule: 'src/engagement/health.ts',
    entryPoints: {
      discordCommands: ['engagement'],
      commandDeckWorkflows: [
        'engagement-metrics',
        'feature-flags',
        'scheduler-controls',
      ],
    },
    audience: 'administrator',
    requiredConfiguration: ['ENGAGEMENT_ENABLED', 'ENGAGEMENT_ADMIN_ROLE_IDS'],
    permissionBoundary:
      'Status is private to the invoker; mutations and deletion require configured administrators and confirmation.',
    persistenceBehavior:
      'Health and metrics are content free; deletion is scoped to Jarvis-owned engagement records.',
    automatedEvidence: [
      'tests/engagement-health.test.ts',
      'tests/engagement-control.test.ts',
      'tests/admin-observability.test.ts',
    ],
    manualSmokeCases: [
      'Inspect engagement status and metrics, pause and resume scheduling, and verify a non-administrator cannot mutate controls.',
    ],
  },
  {
    id: 'daily-progression',
    name: 'Daily rewards and participation streaks',
    status: 'pass',
    ownerModule: 'src/engagement/daily-rewards.ts',
    entryPoints: {
      discordCommands: ['daily', 'streak'],
      commandDeckWorkflows: ['participation-metrics'],
    },
    audience: 'member',
    requiredConfiguration: ['ENGAGEMENT_ENABLED', 'DATABASE_PATH'],
    permissionBoundary:
      'Members can claim and inspect only their own server-scoped progression.',
    persistenceBehavior:
      'Daily claims and streak state are server scoped, idempotent, and content free.',
    automatedEvidence: [
      'tests/daily-reward.test.ts',
      'tests/participation-streaks.test.ts',
    ],
    manualSmokeCases: [
      'Claim /daily twice to verify idempotency, then inspect /streak and confirm another member cannot read private details.',
    ],
  },
  {
    id: 'birthdays-and-role-menus',
    name: 'Birthdays and self-service roles',
    status: 'pass',
    ownerModule: 'src/engagement/birthdays.ts',
    entryPoints: {
      discordCommands: ['birthday', 'roles'],
      commandDeckWorkflows: ['birthday-totals', 'role-menu-readiness'],
    },
    audience: 'member',
    requiredConfiguration: [
      'ENGAGEMENT_BIRTHDAY_CHANNEL_ID',
      'ENGAGEMENT_ROLE_MENU_OPTIONS',
    ],
    permissionBoundary:
      'Members control only their own birthday and allowlisted self-service roles; Jarvis cannot administer unrelated roles.',
    persistenceBehavior:
      'Birthday month/day and timezone are retained without birth year; role selections remain Discord state.',
    automatedEvidence: ['tests/birthdays.test.ts', 'tests/role-menus.test.ts'],
    manualSmokeCases: [
      'Set, show, and delete a birthday, then toggle an allowlisted role and verify hierarchy or allowlist violations are rejected.',
    ],
  },
  {
    id: 'rss-and-personal-notifications',
    name: 'RSS broadcasts and personal notifications',
    status: 'pass',
    ownerModule: 'src/notifications/rss-notifications.ts',
    entryPoints: {
      discordCommands: ['rss', 'notifications'],
      commandDeckWorkflows: ['rss-controls', 'rss-readiness'],
    },
    audience: 'mixed',
    requiredConfiguration: [
      'ENGAGEMENT_RSS_CHANNEL_ID',
      'ENGAGEMENT_RSS_ALLOWED_HOSTS',
      'ENGAGEMENT_ADMIN_ROLE_IDS',
    ],
    permissionBoundary:
      'RSS management requires configured administrators and allowlisted HTTPS hosts; notification preferences are member private.',
    persistenceBehavior:
      'Feed baselines and delivery deduplication are retained; personal preferences contain no message content.',
    automatedEvidence: [
      'tests/rss-command.test.ts',
      'tests/rss-scheduler.test.ts',
      'tests/rss-notifications.test.ts',
      'tests/notification-command.test.ts',
    ],
    manualSmokeCases: [
      'Preview and add an allowlisted RSS feed, verify only new entries post publicly, then test personal notification enable and disable.',
    ],
  },
] as const satisfies readonly FeatureVerificationRecord[];
