export type IntroductionStatus = 'active' | 'deleted' | 'cleanup_pending';
export type SuggestionStatus =
  | 'open'
  | 'acknowledged'
  | 'deferred'
  | 'resolved'
  | 'archived'
  | 'deletion_pending'
  | 'cleanup_pending';
export type EventStatus = 'scheduled' | 'cancelled' | 'completed';
export type RsvpResponse = 'yes' | 'maybe' | 'no';

export interface Introduction {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly ownerUserId: string;
  readonly displayName: string;
  readonly interests: string;
  readonly introduction: string;
  readonly messageId?: string;
  readonly status: IntroductionStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Suggestion {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly description: string;
  readonly messageId?: string;
  readonly status: SuggestionStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Event {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly ownerUserId: string;
  readonly title: string;
  readonly description: string;
  readonly scheduledAt: Date;
  readonly endsAt?: Date;
  readonly timezone: string;
  readonly capacity: number;
  readonly messageId?: string;
  readonly destinationMissed?: boolean;
  readonly status: EventStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Rsvp {
  readonly eventId: string;
  readonly guildId: string;
  readonly userId: string;
  readonly response: RsvpResponse;
  readonly attendance?: 'confirmed' | 'waitlisted' | 'none';
  readonly reminderOptIn?: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EngagementOptOut {
  readonly guildId: string;
  readonly userId: string;
  readonly optedOutAt: Date;
}
