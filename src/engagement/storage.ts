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

export type EngagementIdempotencyScope = 'interaction' | 'scheduled-job';

export class EngagementRecordConflictError extends Error {}
export class EngagementOptOutError extends Error {}

export interface EngagementRepository {
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
  getOptOut(
    guildId: string,
    userId: string,
  ): Promise<EngagementOptOut | undefined>;
  setOptOut(input: EngagementOptOut): Promise<EngagementOptOut>;
  deleteOwnerData(guildId: string, userId: string): Promise<number>;
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
