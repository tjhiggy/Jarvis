import type {
  EngagementOptOut,
  Event,
  EventStatus,
  Introduction,
  IntroductionStatus,
  Rsvp,
  Suggestion,
  SuggestionStatus,
} from './domain.js';
import type {
  ClaimedTriviaRound,
  TriviaAnswer,
  TriviaResults,
  TriviaRound,
} from './activity.js';
import type { EngagementRecordCounts } from './health.js';
import type { FeatureFlagName, FeatureFlagRecord } from './feature-flags.js';
import type { PlatformMetricsRepository } from '../platform/metrics.js';

export type EngagementIdempotencyScope = 'interaction' | 'scheduled-job';

/**
 * A reminder is useful shortly after its due time, not as delayed unsolicited
 * outreach. This grace covers a brief policy pause or restart before it is
 * marked terminal without a Discord delivery.
 */
export const eventReminderRetryGraceMs = 15 * 60 * 1_000;

export class EngagementRecordConflictError extends Error {}
export class EngagementOptOutError extends Error {}
export class EngagementEventClosedError extends Error {}

export type EngagementCardDeletionKind =
  'introduction' | 'suggestion' | 'event';
export interface EngagementCardDeletion {
  readonly kind: EngagementCardDeletionKind;
  readonly guildId: string;
  readonly recordId: string;
  readonly ownerUserId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly createdAt: Date;
}

export interface EngagementRepository extends Partial<PlatformMetricsRepository> {
  getMemberProfile?(
    serverId: string,
    userId: string,
  ): Promise<import('./member-profiles.js').MemberProfile | undefined>;
  createMemberProfile?(
    profile: import('./member-profiles.js').MemberProfile,
  ): Promise<'created' | 'duplicate'>;
  updateMemberProfile?(
    serverId: string,
    userId: string,
    values: Pick<
      import('./member-profiles.js').MemberProfile,
      'bio' | 'interests' | 'updatedAt'
    >,
  ): Promise<boolean>;
  setMemberProfileVisibility?(
    serverId: string,
    userId: string,
    visibility: import('./member-profiles.js').MemberProfile['visibility'],
    updatedAt: Date,
  ): Promise<boolean>;
  deleteMemberProfile?(serverId: string, userId: string): Promise<boolean>;
  getFeatureFlags?(guildId: string): Promise<readonly FeatureFlagRecord[]>;
  setFeatureFlag?(
    guildId: string,
    name: FeatureFlagName,
    enabled: boolean,
    updatedAt?: Date,
  ): Promise<void>;
  getProactiveState?(guildId: string): Promise<{
    state: import('./proactive.js').ProactiveState;
    lastPostedAt?: Date;
  }>;
  setProactiveState?(
    guildId: string,
    state: import('./proactive.js').ProactiveState,
    updatedAt: Date,
  ): Promise<void>;
  recordProactivePosted?(guildId: string, postedAt: Date): Promise<void>;
  claimProactive?(guildId: string, key: string, now: Date): Promise<boolean>;
  getBirthday?(
    guildId: string,
    userId: string,
  ): Promise<import('./birthdays.js').BirthdayRecord | undefined>;
  saveBirthday?(
    record: import('./birthdays.js').BirthdayRecord,
  ): Promise<import('./birthdays.js').BirthdayRecord>;
  deleteBirthday?(guildId: string, userId: string): Promise<boolean>;
  listDueBirthdays?(
    guildId: string,
    month: number,
    day: number,
  ): Promise<readonly import('./birthdays.js').BirthdayRecord[]>;
  claimBirthdayAnnouncement?(
    guildId: string,
    month: number,
    day: number,
    userId: string,
  ): Promise<boolean>;
  engagementPaused?(guildId: string): Promise<boolean>;
  setEngagementPaused?(
    guildId: string,
    paused: boolean,
    actorUserId: string,
    updatedAt: Date,
  ): Promise<void>;
  operationalAudit?(
    guildId: string,
    limit: number,
  ): Promise<
    readonly {
      guildId: string;
      actorUserId: string;
      operation: 'engagement_pause' | 'engagement_resume';
      createdAt: Date;
    }[]
  >;
  statusCounts?(guildId: string): Promise<EngagementRecordCounts>;
  recapSource?(
    guildId: string,
    start: Date,
    end: Date,
  ): Promise<{
    readonly guildId: string;
    readonly introductions: number;
    readonly suggestions: number;
    readonly events: number;
    readonly participantUserIds: readonly string[];
    readonly botActivity: number;
  }>;
  recapEnabled?(guildId: string): Promise<boolean>;
  setRecapEnabled?(
    guildId: string,
    enabled: boolean,
    updatedAt: Date,
  ): Promise<void>;
  claimRecapRun?(
    guildId: string,
    key: string,
    now: Date,
  ): Promise<string | undefined>;
  completeRecapRun?(
    guildId: string,
    key: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  releaseRecapRun?(
    guildId: string,
    key: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  createIntroduction(input: Introduction): Promise<Introduction>;
  getIntroduction(
    guildId: string,
    introductionId: string,
  ): Promise<Introduction | undefined>;
  findActiveIntroductionByOwner(
    guildId: string,
    ownerUserId: string,
  ): Promise<Introduction | undefined>;
  updateIntroductionMessageId(
    guildId: string,
    introductionId: string,
    messageId: string,
  ): Promise<Introduction | undefined>;
  updateIntroductionStatus(
    guildId: string,
    ownerUserId: string,
    introductionId: string,
    status: IntroductionStatus,
    updatedAt: Date,
  ): Promise<Introduction | undefined>;
  listExpiredIntroductions(
    cutoff: Date,
    limit: number,
  ): Promise<Introduction[]>;
  deleteIntroductionRecord(
    guildId: string,
    introductionId: string,
  ): Promise<boolean>;
  createSuggestion(input: Suggestion): Promise<Suggestion>;
  getSuggestion(
    guildId: string,
    suggestionId: string,
  ): Promise<Suggestion | undefined>;
  findActiveSuggestionByContent(
    guildId: string,
    title: string,
    description: string,
  ): Promise<Suggestion | undefined>;
  updateSuggestionMessageId(
    guildId: string,
    suggestionId: string,
    messageId: string,
  ): Promise<Suggestion | undefined>;
  deleteSuggestionRecord(
    guildId: string,
    suggestionId: string,
  ): Promise<boolean>;
  claimOpenSuggestionForDeletion(
    guildId: string,
    ownerUserId: string,
    suggestionId: string,
    updatedAt: Date,
  ): Promise<Suggestion | undefined>;
  deletePendingSuggestionRecord(
    guildId: string,
    suggestionId: string,
  ): Promise<boolean>;
  restorePendingSuggestion(
    guildId: string,
    suggestionId: string,
    updatedAt: Date,
  ): Promise<Suggestion | undefined>;
  updateSuggestionStatus(
    guildId: string,
    suggestionId: string,
    status: SuggestionStatus,
    updatedAt: Date,
  ): Promise<Suggestion | undefined>;
  transitionSuggestionStatus(
    guildId: string,
    suggestionId: string,
    expectedStatus: SuggestionStatus,
    status: SuggestionStatus,
    updatedAt: Date,
  ): Promise<Suggestion | undefined>;
  markSuggestionCleanupPending(
    guildId: string,
    suggestionId: string,
    messageId: string,
    updatedAt: Date,
  ): Promise<Suggestion | undefined>;
  listCleanupPendingSuggestions(limit: number): Promise<Suggestion[]>;
  claimExpiredSuggestions?(
    cutoff: Date,
    limit: number,
    updatedAt: Date,
  ): Promise<Suggestion[]>;
  createEvent(input: Event): Promise<Event>;
  getEvent(guildId: string, eventId: string): Promise<Event | undefined>;
  listEvents?(guildId: string, now: Date, limit: number): Promise<Event[]>;
  listRsvps?(guildId: string, eventId: string): Promise<Rsvp[]>;
  updateEventStatus(
    guildId: string,
    eventId: string,
    status: EventStatus,
    updatedAt: Date,
  ): Promise<Event | undefined>;
  upsertRsvp(input: Rsvp): Promise<Rsvp>;
  createTriviaRound?(input: TriviaRound): Promise<TriviaRound>;
  getTriviaRound?(
    guildId: string,
    roundId: string,
  ): Promise<TriviaRound | undefined>;
  findOpenTriviaRound?(
    guildId: string,
    channelId: string,
  ): Promise<TriviaRound | undefined>;
  recordTriviaAnswer?(input: TriviaAnswer): Promise<TriviaAnswer>;
  getTriviaResults?(guildId: string, roundId: string): Promise<TriviaResults>;
  expireTriviaRounds?(now: Date): Promise<number>;
  claimTriviaResultCards?(
    now: Date,
    limit: number,
  ): Promise<readonly ClaimedTriviaRound[]>;
  completeTriviaResultCard?(
    guildId: string,
    roundId: string,
    leaseToken: string,
    completedAt: Date,
  ): Promise<boolean>;
  releaseTriviaResultCard?(
    guildId: string,
    roundId: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  respondToEvent?(input: Rsvp): Promise<Rsvp>;
  updateEventMessageId?(
    guildId: string,
    eventId: string,
    messageId: string,
  ): Promise<Event | undefined>;
  markEventDestinationMissed?(
    guildId: string,
    eventId: string,
    updatedAt: Date,
  ): Promise<void>;
  closeDueEvents?(now: Date, limit: number): Promise<number>;
  claimDueEventReminders?(
    now: Date,
    limit: number,
  ): Promise<
    readonly {
      eventId: string;
      guildId: string;
      channelId: string;
      userId: string;
      title: string;
      scheduledAt: Date;
      leaseToken: string;
    }[]
  >;
  markEventReminderDelivered?(
    eventId: string,
    guildId: string,
    userId: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  markEventReminderFailed?(
    eventId: string,
    guildId: string,
    userId: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  releaseEventReminder?(
    eventId: string,
    guildId: string,
    userId: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  getOptOut(
    guildId: string,
    userId: string,
  ): Promise<EngagementOptOut | undefined>;
  setOptOut(input: EngagementOptOut): Promise<EngagementOptOut>;
  clearOptOut?(guildId: string, userId: string): Promise<void>;
  deleteTriviaParticipant?(guildId: string, userId: string): Promise<number>;
  optOutTriviaParticipant?(
    guildId: string,
    userId: string,
    optedOutAt: Date,
  ): Promise<void>;
  deleteOwnerData(guildId: string, userId: string): Promise<number>;
  listPendingCardDeletions?(
    limit: number,
  ): Promise<readonly EngagementCardDeletion[]>;
  listPendingCardDeletionsForOwner?(
    guildId: string,
    userId: string,
    limit: number,
  ): Promise<readonly EngagementCardDeletion[]>;
  completeCardDeletion?(deletion: EngagementCardDeletion): Promise<boolean>;
  claimIdempotencyKey(
    guildId: string,
    scope: EngagementIdempotencyScope,
    key: string,
    createdAt: Date,
  ): Promise<boolean>;
  cleanup(cutoff: Date, limit: number): Promise<number>;
  healthCheck(): Promise<boolean>;
  closeConnection(): Promise<void>;
}
