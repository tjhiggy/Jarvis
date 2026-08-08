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
  updateSuggestionStatus(
    guildId: string,
    suggestionId: string,
    status: SuggestionStatus,
    updatedAt: Date,
  ): Promise<Suggestion | undefined>;
  createEvent(input: Event): Promise<Event>;
  getEvent(guildId: string, eventId: string): Promise<Event | undefined>;
  updateEventStatus(
    guildId: string,
    eventId: string,
    status: EventStatus,
    updatedAt: Date,
  ): Promise<Event | undefined>;
  upsertRsvp(input: Rsvp): Promise<Rsvp>;
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
