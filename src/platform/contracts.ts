export type PlatformCapability =
  'command' | 'scheduled-delivery' | 'provider' | 'storage';

export interface InteractionContext {
  readonly serverId: string;
  readonly channelId: string;
  readonly threadId?: string;
  readonly userId: string;
  readonly correlationId: string;
  readonly surface: 'discord' | 'admin-console' | 'scheduler';
  readonly isAdministrator: boolean;
}

export type AuthorizationRequirement = 'member' | 'administrator';

export interface AuthorizationPolicy {
  readonly requirement: AuthorizationRequirement;
  authorize(context: InteractionContext): boolean;
}

export const createAuthorizationPolicy = (
  requirement: AuthorizationRequirement,
): AuthorizationPolicy =>
  Object.freeze({
    requirement,
    authorize: (context: InteractionContext) =>
      requirement === 'member' || context.isAdministrator,
  });

export interface PlatformHealth {
  readonly state: 'healthy' | 'degraded' | 'unavailable';
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

export interface PlatformModule {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly PlatformCapability[];
  register(): void;
  health(): Promise<PlatformHealth>;
}

export type AnalyticsEventName =
  | 'command_started'
  | 'command_succeeded'
  | 'command_failed'
  | 'command_cancelled'
  | 'delivery_succeeded'
  | 'delivery_failed'
  | 'user_opted_in'
  | 'user_opted_out';

export interface AnalyticsEvent {
  readonly name: AnalyticsEventName;
  readonly occurredAt: string;
  readonly serverId: string;
  readonly channelId: string;
  readonly feature: string;
  readonly command?: string;
  readonly result: 'success' | 'failure' | 'cancelled';
  readonly durationMs?: number;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface AuditEvent {
  readonly occurredAt: string;
  readonly serverId: string;
  readonly actorId: string;
  readonly operation: string;
  readonly result: 'success' | 'failure' | 'cancelled';
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

type SafeValue = string | number | boolean;

const safeMetadata = (
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, SafeValue>> => {
  const result: Record<string, SafeValue> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (
      /content|message|prompt|token|secret|key|authorization|password/i.test(
        key,
      )
    )
      continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[key] = typeof value === 'string' ? value.slice(0, 120) : value;
    }
  }
  return Object.freeze(result);
};

export const createAnalyticsEvent = (input: {
  readonly name: AnalyticsEventName;
  readonly context: InteractionContext;
  readonly feature: string;
  readonly command?: string;
  readonly result: AnalyticsEvent['result'];
  readonly durationMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): AnalyticsEvent =>
  Object.freeze({
    name: input.name,
    occurredAt: new Date().toISOString(),
    serverId: input.context.serverId,
    channelId: input.context.channelId,
    feature: input.feature.slice(0, 80),
    ...(input.command === undefined
      ? {}
      : { command: input.command.slice(0, 120) }),
    result: input.result,
    ...(input.durationMs === undefined
      ? {}
      : { durationMs: Math.max(0, Math.round(input.durationMs)) }),
    metadata: safeMetadata(input.metadata),
  });

export const createAuditEvent = (input: {
  readonly context: InteractionContext;
  readonly operation: string;
  readonly result: AuditEvent['result'];
  readonly metadata?: Readonly<Record<string, unknown>>;
}): AuditEvent =>
  Object.freeze({
    occurredAt: new Date().toISOString(),
    serverId: input.context.serverId,
    actorId: input.context.userId,
    operation: input.operation.slice(0, 120),
    result: input.result,
    metadata: safeMetadata(input.metadata),
  });
