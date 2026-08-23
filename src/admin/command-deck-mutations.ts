export type CommandDeckMutationAction =
  | {
      readonly type: 'broadcast_state';
      readonly category: string;
      readonly state: 'enabled' | 'paused';
    }
  | {
      readonly type: 'feature_flag';
      readonly feature: string;
      readonly enabled: boolean;
    }
  | {
      readonly type: 'rss_feed';
      readonly operation: 'add' | 'remove';
      readonly url: string;
      readonly label?: string;
    };

export interface CommandDeckMutationApplyRequest {
  readonly action: CommandDeckMutationAction;
  readonly expectedValue: unknown;
  readonly nextValue: unknown;
  readonly operationId: string;
}

export type CommandDeckMutationApplyResult =
  'applied' | 'already_applied' | 'precondition_failed';

export interface CommandDeckMutationAdapter {
  readonly allowedBroadcastCategories: readonly string[];
  readonly supportedFeatureFlags: readonly string[];
  readonly allowedRssHosts: readonly string[];
  read(action: CommandDeckMutationAction): Promise<unknown>;
  apply(
    request: CommandDeckMutationApplyRequest,
  ): Promise<CommandDeckMutationApplyResult>;
  operationStatus(operationId: string): Promise<'applied' | 'not_applied'>;
  targetFor(action: CommandDeckMutationAction): string;
}

export interface CommandDeckMutationAuditEvent {
  readonly event:
    | 'previewed'
    | 'cancelled'
    | 'confirmed'
    | 'confirmation_failed'
    | 'rollback_previewed'
    | 'rollback_confirmed'
    | 'rollback_conflict';
  readonly actionType: CommandDeckMutationAction['type'];
  readonly previewId?: string;
  readonly receiptId?: string;
}

export interface CommandDeckMutationPreview {
  readonly id: string;
  readonly expiresAt: string;
  readonly target: string;
  readonly diff: { readonly before: unknown; readonly after: unknown };
}

export interface CommandDeckMutationReceipt {
  readonly id: string;
  readonly confirmedAt: string;
  readonly target: string;
  readonly rollbackToken?: string;
}

type ErrorCode =
  | 'INVALID_ACTION'
  | 'PREVIEW_NOT_FOUND'
  | 'PREVIEW_STALE'
  | 'PREVIEW_CANCELLED'
  | 'PREVIEW_MISMATCH'
  | 'PREVIEW_USED'
  | 'CONFIRMATION_IN_PROGRESS'
  | 'IDEMPOTENCY_MISMATCH'
  | 'APPLY_FAILED'
  | 'APPLY_OUTCOME_UNKNOWN'
  | 'PRECONDITION_FAILED'
  | 'ROLLBACK_NOT_FOUND'
  | 'ROLLBACK_CONFLICT';

interface CommandDeckMutationError {
  readonly code: ErrorCode;
  readonly message: string;
}

export type CommandDeckMutationPreviewResult =
  | { readonly ok: true; readonly preview: CommandDeckMutationPreview }
  | { readonly ok: false; readonly error: CommandDeckMutationError };
export type CommandDeckMutationConfirmResult =
  | { readonly ok: true; readonly receipt: CommandDeckMutationReceipt }
  | { readonly ok: false; readonly error: CommandDeckMutationError };
export type CommandDeckMutationCancelResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: CommandDeckMutationError };

export interface CreateCommandDeckMutationServiceOptions {
  readonly adapter: CommandDeckMutationAdapter;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly audit?: (
    event: CommandDeckMutationAuditEvent,
  ) => void | Promise<void>;
}

interface PreviewSession {
  readonly id: string;
  readonly action: CommandDeckMutationAction;
  readonly before: unknown;
  readonly after: unknown;
  readonly expectedValue: unknown;
  readonly expiresAt: string;
  readonly target: string;
  readonly operationId: string;
  readonly kind: 'change' | 'rollback';
  cancelled: boolean;
  receipt: CommandDeckMutationReceipt | undefined;
  inFlight: InFlightConfirmation | undefined;
}

interface InFlightConfirmation {
  readonly idempotencyKey: string;
  readonly result: Promise<CommandDeckMutationConfirmResult>;
}

interface CompletedConfirmation {
  readonly previewId: string;
  readonly receipt: CommandDeckMutationReceipt;
}

const previewLifetimeMilliseconds = 5 * 60 * 1000;

const error = (code: ErrorCode, message: string) => ({
  ok: false as const,
  error: { code, message },
});
const clone = (value: unknown): unknown => structuredClone(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key));

const canonical = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
};

const sameValue = (left: unknown, right: unknown): boolean =>
  canonical(left) === canonical(right);

const isAction = (value: unknown): value is CommandDeckMutationAction => {
  if (!isRecord(value) || !hasText(value.type)) return false;
  if (value.type === 'broadcast_state')
    return (
      hasOnlyKeys(value, ['type', 'category', 'state']) &&
      hasText(value.category) &&
      (value.state === 'enabled' || value.state === 'paused')
    );
  if (value.type === 'feature_flag')
    return (
      hasOnlyKeys(value, ['type', 'feature', 'enabled']) &&
      hasText(value.feature) &&
      typeof value.enabled === 'boolean'
    );
  if (value.type === 'rss_feed')
    return (
      hasOnlyKeys(value, ['type', 'operation', 'url', 'label']) &&
      (value.operation === 'add' || value.operation === 'remove') &&
      hasText(value.url) &&
      (value.label === undefined || hasText(value.label))
    );
  return false;
};

const desiredValue = (action: CommandDeckMutationAction): unknown => {
  switch (action.type) {
    case 'broadcast_state':
      return action.state === 'enabled';
    case 'feature_flag':
      return action.enabled;
    case 'rss_feed':
      return action.operation === 'add'
        ? { url: action.url, label: action.label?.trim() }
        : undefined;
  }
};

export const createCommandDeckMutationService = ({
  adapter,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
  audit,
}: CreateCommandDeckMutationServiceOptions) => {
  const previews = new Map<string, PreviewSession>();
  const completed = new Map<string, CompletedConfirmation>();
  const rollbackSources = new Map<string, PreviewSession>();

  const record = (event: CommandDeckMutationAuditEvent): void => {
    if (audit === undefined) return;
    try {
      void Promise.resolve(audit(event)).catch(() => undefined);
    } catch {
      /* audit never changes a mutation outcome */
    }
  };

  const validates = (action: CommandDeckMutationAction): boolean => {
    switch (action.type) {
      case 'broadcast_state':
        return adapter.allowedBroadcastCategories.includes(action.category);
      case 'feature_flag':
        return adapter.supportedFeatureFlags.includes(action.feature);
      case 'rss_feed': {
        if (action.operation === 'add' && action.label === undefined)
          return false;
        try {
          const url = new URL(action.url);
          return (
            url.protocol === 'https:' &&
            adapter.allowedRssHosts.includes(url.hostname)
          );
        } catch {
          return false;
        }
      }
    }
  };

  const renderPreview = (
    session: PreviewSession,
  ): CommandDeckMutationPreview => ({
    id: session.id,
    expiresAt: session.expiresAt,
    target: session.target,
    diff: { before: clone(session.before), after: clone(session.after) },
  });

  const createPreview = (args: {
    action: CommandDeckMutationAction;
    before: unknown;
    after: unknown;
    expectedValue: unknown;
    kind: PreviewSession['kind'];
  }): PreviewSession => {
    const previewAt = now();
    const session: PreviewSession = {
      id: createId(),
      action: clone(args.action) as CommandDeckMutationAction,
      before: clone(args.before),
      after: clone(args.after),
      expectedValue: clone(args.expectedValue),
      expiresAt: new Date(
        previewAt.getTime() + previewLifetimeMilliseconds,
      ).toISOString(),
      target: adapter.targetFor(args.action),
      operationId: createId(),
      kind: args.kind,
      cancelled: false,
      receipt: undefined,
      inFlight: undefined,
    };
    previews.set(session.id, session);
    return session;
  };

  const preview = async (
    input: unknown,
  ): Promise<CommandDeckMutationPreviewResult> => {
    if (!isAction(input) || !validates(input))
      return error(
        'INVALID_ACTION',
        'This Command Deck action is not supported for this Jarvis installation.',
      );
    const action = clone(input) as CommandDeckMutationAction;
    const before = clone(await adapter.read(action));
    const session = createPreview({
      action,
      before,
      after: desiredValue(action),
      expectedValue: before,
      kind: 'change',
    });
    record({
      event: 'previewed',
      actionType: action.type,
      previewId: session.id,
    });
    return { ok: true, preview: renderPreview(session) };
  };

  const complete = (
    session: PreviewSession,
    idempotencyKey: string,
  ): CommandDeckMutationConfirmResult => {
    const rollbackToken = session.kind === 'change' ? createId() : undefined;
    const receipt: CommandDeckMutationReceipt = {
      id: createId(),
      confirmedAt: now().toISOString(),
      target: session.target,
      ...(rollbackToken === undefined ? {} : { rollbackToken }),
    };
    session.receipt = receipt;
    completed.set(idempotencyKey, { previewId: session.id, receipt });
    if (rollbackToken !== undefined)
      rollbackSources.set(rollbackToken, session);
    record({
      event: session.kind === 'change' ? 'confirmed' : 'rollback_confirmed',
      actionType: session.action.type,
      previewId: session.id,
      receiptId: receipt.id,
    });
    return { ok: true, receipt: clone(receipt) as CommandDeckMutationReceipt };
  };

  const runConfirmation = async (
    session: PreviewSession,
    idempotencyKey: string,
  ): Promise<CommandDeckMutationConfirmResult> => {
    try {
      const result = await adapter.apply({
        action: clone(session.action) as CommandDeckMutationAction,
        expectedValue: clone(session.expectedValue),
        nextValue: clone(session.after),
        operationId: session.operationId,
      });
      if (result === 'precondition_failed') {
        if (session.kind === 'rollback')
          record({
            event: 'rollback_conflict',
            actionType: session.action.type,
            previewId: session.id,
          });
        return error(
          'PRECONDITION_FAILED',
          'This target changed after the preview and was not modified.',
        );
      }
      return complete(session, idempotencyKey);
    } catch {
      let status: 'applied' | 'not_applied';
      try {
        status = await adapter.operationStatus(session.operationId);
      } catch {
        return error(
          'APPLY_OUTCOME_UNKNOWN',
          'Jarvis could not verify whether this change was applied. Retry the same confirmation.',
        );
      }
      if (status === 'applied') return complete(session, idempotencyKey);
      record({
        event: 'confirmation_failed',
        actionType: session.action.type,
        previewId: session.id,
      });
      return error(
        'APPLY_FAILED',
        'Jarvis could not apply this change. Retry the same confirmation.',
      );
    }
  };

  const confirmSession = (
    session: PreviewSession,
    idempotencyKey: string,
  ): Promise<CommandDeckMutationConfirmResult> => {
    if (session.inFlight !== undefined) {
      return session.inFlight.idempotencyKey === idempotencyKey
        ? session.inFlight.result
        : Promise.resolve(
            error(
              'CONFIRMATION_IN_PROGRESS',
              'A confirmation is already in progress for this preview.',
            ),
          );
    }
    const pending = runConfirmation(session, idempotencyKey);
    session.inFlight = { idempotencyKey, result: pending };
    void pending.finally(() => {
      if (session.inFlight?.result === pending) session.inFlight = undefined;
    });
    return pending;
  };

  const getSessionForConfirmation = (
    previewId: string,
  ): PreviewSession | CommandDeckMutationConfirmResult => {
    const session = previews.get(previewId);
    if (session === undefined)
      return error(
        'PREVIEW_NOT_FOUND',
        'This preview is no longer available. Create a new preview.',
      );
    if (session.cancelled)
      return error(
        'PREVIEW_CANCELLED',
        'This preview was cancelled and cannot be confirmed.',
      );
    if (now().getTime() > new Date(session.expiresAt).getTime())
      return error(
        'PREVIEW_STALE',
        'This preview has expired. Create a new preview before confirming.',
      );
    if (session.receipt !== undefined)
      return error('PREVIEW_USED', 'This preview was already confirmed.');
    return session;
  };

  const confirm = async (
    input: unknown,
  ): Promise<CommandDeckMutationConfirmResult> => {
    if (
      !isRecord(input) ||
      !hasText(input.previewId) ||
      !hasText(input.idempotencyKey) ||
      !isAction(input.action)
    )
      return error(
        'PREVIEW_MISMATCH',
        'Confirmation does not match a valid preview.',
      );
    const prior = completed.get(input.idempotencyKey);
    if (prior !== undefined)
      return prior.previewId === input.previewId
        ? {
            ok: true,
            receipt: clone(prior.receipt) as CommandDeckMutationReceipt,
          }
        : error(
            'IDEMPOTENCY_MISMATCH',
            'This idempotency key belongs to a different confirmation.',
          );
    const candidate = getSessionForConfirmation(input.previewId);
    if ('ok' in candidate) return candidate;
    if (
      candidate.kind !== 'change' ||
      !sameValue(candidate.action, input.action)
    )
      return error(
        'PREVIEW_MISMATCH',
        'Confirmation does not match a valid preview.',
      );
    return confirmSession(candidate, input.idempotencyKey);
  };

  const cancel = async (
    previewId: string,
  ): Promise<CommandDeckMutationCancelResult> => {
    const session = previews.get(previewId);
    if (session === undefined)
      return error(
        'PREVIEW_NOT_FOUND',
        'This preview is no longer available. Create a new preview.',
      );
    if (session.inFlight !== undefined)
      return error(
        'CONFIRMATION_IN_PROGRESS',
        'A confirmation is already in progress for this preview.',
      );
    if (session.receipt !== undefined)
      return error('PREVIEW_USED', 'This preview was already confirmed.');
    session.cancelled = true;
    record({ event: 'cancelled', actionType: session.action.type, previewId });
    return { ok: true };
  };

  const previewRollback = async (
    token: string,
  ): Promise<CommandDeckMutationPreviewResult> => {
    const source = rollbackSources.get(token);
    if (source === undefined)
      return error(
        'ROLLBACK_NOT_FOUND',
        'This rollback token is not available.',
      );
    const current = clone(await adapter.read(source.action));
    if (!sameValue(current, source.after)) {
      record({
        event: 'rollback_conflict',
        actionType: source.action.type,
        previewId: source.id,
      });
      return error(
        'ROLLBACK_CONFLICT',
        'Rollback is unavailable because the target changed after this confirmation.',
      );
    }
    const session = createPreview({
      action: source.action,
      before: current,
      after: source.before,
      expectedValue: source.after,
      kind: 'rollback',
    });
    record({
      event: 'rollback_previewed',
      actionType: session.action.type,
      previewId: session.id,
    });
    return { ok: true, preview: renderPreview(session) };
  };

  const confirmRollback = async (
    input: unknown,
  ): Promise<CommandDeckMutationConfirmResult> => {
    if (
      !isRecord(input) ||
      !hasText(input.previewId) ||
      !hasText(input.idempotencyKey)
    )
      return error(
        'PREVIEW_MISMATCH',
        'Confirmation does not match a valid rollback preview.',
      );
    const prior = completed.get(input.idempotencyKey);
    if (prior !== undefined)
      return prior.previewId === input.previewId
        ? {
            ok: true,
            receipt: clone(prior.receipt) as CommandDeckMutationReceipt,
          }
        : error(
            'IDEMPOTENCY_MISMATCH',
            'This idempotency key belongs to a different confirmation.',
          );
    const candidate = getSessionForConfirmation(input.previewId);
    if ('ok' in candidate) return candidate;
    if (candidate.kind !== 'rollback')
      return error(
        'PREVIEW_MISMATCH',
        'Confirmation does not match a valid rollback preview.',
      );
    return confirmSession(candidate, input.idempotencyKey);
  };

  return { preview, confirm, cancel, previewRollback, confirmRollback };
};
