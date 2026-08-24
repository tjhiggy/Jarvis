import { commandDeckRssFeedId } from './command-deck-rss-feed.js';

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
      readonly operation: 'add';
      readonly url: string;
      readonly label: string;
    }
  | {
      readonly type: 'rss_feed';
      readonly operation: 'remove';
      readonly feedId: string;
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

export interface CommandDeckMutationStoredPreview {
  readonly id: string;
  readonly action: CommandDeckMutationAction;
  readonly before: unknown;
  readonly after: unknown;
  readonly expectedValue: unknown;
  readonly expiresAt: string;
  readonly target: string;
  readonly operationId: string;
  readonly kind: 'change' | 'rollback';
  readonly cancelled: boolean;
  readonly receipt?: CommandDeckMutationReceipt | undefined;
}

export interface CommandDeckMutationStoredCompletion {
  readonly previewId: string;
  readonly receipt: CommandDeckMutationReceipt;
}

export type CommandDeckMutationStoreCompletionResult =
  | {
      readonly status: 'completed';
      readonly receipt: CommandDeckMutationReceipt;
      readonly created: boolean;
    }
  | { readonly status: 'idempotency_mismatch' }
  | { readonly status: 'preview_used' };

export interface CommandDeckMutationStateStore {
  savePreview(preview: CommandDeckMutationStoredPreview): Promise<void>;
  getPreview(
    previewId: string,
  ): Promise<CommandDeckMutationStoredPreview | undefined>;
  getCompleted(
    idempotencyKey: string,
  ): Promise<CommandDeckMutationStoredCompletion | undefined>;
  complete(
    preview: CommandDeckMutationStoredPreview,
    idempotencyKey: string,
    receipt: CommandDeckMutationReceipt,
  ): Promise<CommandDeckMutationStoreCompletionResult>;
  getRollbackSource(
    rollbackToken: string,
  ): Promise<CommandDeckMutationStoredPreview | undefined>;
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
  readonly stateStore?: CommandDeckMutationStateStore;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly audit?: (
    event: CommandDeckMutationAuditEvent,
  ) => void | Promise<void>;
}

interface InFlightConfirmation {
  readonly idempotencyKey: string;
  readonly result: Promise<CommandDeckMutationConfirmResult>;
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
  if (value.type === 'rss_feed') {
    if (value.operation === 'add')
      return (
        hasOnlyKeys(value, ['type', 'operation', 'url', 'label']) &&
        hasText(value.url) &&
        hasText(value.label)
      );
    if (value.operation === 'remove')
      return (
        hasOnlyKeys(value, ['type', 'operation', 'feedId']) &&
        hasText(value.feedId) &&
        /^rss_[a-f0-9]{32}$/.test(value.feedId)
      );
  }
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
        ? { url: action.url, label: action.label.trim() }
        : undefined;
  }
};

export const createCommandDeckMutationService = ({
  adapter,
  stateStore: configuredStateStore,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
  audit,
}: CreateCommandDeckMutationServiceOptions) => {
  const stateStore = configuredStateStore ?? createMemoryMutationStateStore();
  const inFlight = new Map<string, InFlightConfirmation>();

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
        if (action.operation === 'remove') return true;
        try {
          const url = new URL(action.url);
          return (
            url.protocol === 'https:' &&
            url.username === '' &&
            url.password === '' &&
            adapter.allowedRssHosts.includes(url.hostname)
          );
        } catch {
          return false;
        }
      }
    }
  };

  const publicMutationValue = (value: unknown): unknown => {
    if (!isRecord(value) || !hasText(value.url)) return clone(value);
    return {
      feedId: commandDeckRssFeedId(value.url),
      ...(hasText(value.label) ? { label: value.label.trim() } : {}),
    };
  };

  const renderPreview = (
    session: CommandDeckMutationStoredPreview,
  ): CommandDeckMutationPreview => ({
    id: session.id,
    expiresAt: session.expiresAt,
    target: session.target,
    diff:
      session.action.type === 'rss_feed'
        ? {
            before: publicMutationValue(session.before),
            after: publicMutationValue(session.after),
          }
        : { before: clone(session.before), after: clone(session.after) },
  });

  const createPreview = async (args: {
    action: CommandDeckMutationAction;
    before: unknown;
    after: unknown;
    expectedValue: unknown;
    kind: CommandDeckMutationStoredPreview['kind'];
  }): Promise<CommandDeckMutationStoredPreview> => {
    const previewAt = now();
    const session: CommandDeckMutationStoredPreview = {
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
    };
    await stateStore.savePreview(session);
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
    const session = await createPreview({
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

  const complete = async (
    session: CommandDeckMutationStoredPreview,
    idempotencyKey: string,
  ): Promise<CommandDeckMutationConfirmResult> => {
    const rollbackToken = session.kind === 'change' ? createId() : undefined;
    const receipt: CommandDeckMutationReceipt = {
      id: createId(),
      confirmedAt: now().toISOString(),
      target: session.target,
      ...(rollbackToken === undefined ? {} : { rollbackToken }),
    };
    const stored = await stateStore.complete(session, idempotencyKey, receipt);
    if (stored.status === 'idempotency_mismatch')
      return error(
        'IDEMPOTENCY_MISMATCH',
        'This idempotency key belongs to a different confirmation.',
      );
    if (stored.status === 'preview_used')
      return error('PREVIEW_USED', 'This preview was already confirmed.');
    if (stored.created)
      record({
        event: session.kind === 'change' ? 'confirmed' : 'rollback_confirmed',
        actionType: session.action.type,
        previewId: session.id,
        receiptId: stored.receipt.id,
      });
    return {
      ok: true,
      receipt: clone(stored.receipt) as CommandDeckMutationReceipt,
    };
  };

  const runConfirmation = async (
    session: CommandDeckMutationStoredPreview,
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
      return await complete(session, idempotencyKey);
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
    session: CommandDeckMutationStoredPreview,
    idempotencyKey: string,
  ): Promise<CommandDeckMutationConfirmResult> => {
    const existing = inFlight.get(session.id);
    if (existing !== undefined) {
      return existing.idempotencyKey === idempotencyKey
        ? existing.result
        : Promise.resolve(
            error(
              'CONFIRMATION_IN_PROGRESS',
              'A confirmation is already in progress for this preview.',
            ),
          );
    }
    const pending = runConfirmation(session, idempotencyKey);
    inFlight.set(session.id, { idempotencyKey, result: pending });
    void pending.finally(() => {
      if (inFlight.get(session.id)?.result === pending)
        inFlight.delete(session.id);
    });
    return pending;
  };

  const getSessionForConfirmation = async (
    previewId: string,
  ): Promise<
    CommandDeckMutationStoredPreview | CommandDeckMutationConfirmResult
  > => {
    const session = await stateStore.getPreview(previewId);
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
    if (session.receipt !== undefined)
      return error('PREVIEW_USED', 'This preview was already confirmed.');
    return session;
  };

  const stalePreview = (): CommandDeckMutationConfirmResult =>
    error(
      'PREVIEW_STALE',
      'This preview has expired. Create a new preview before confirming.',
    );

  const recoverExpiredApplied = async (
    session: CommandDeckMutationStoredPreview,
    idempotencyKey: string,
  ): Promise<CommandDeckMutationConfirmResult> => {
    try {
      if ((await adapter.operationStatus(session.operationId)) !== 'applied')
        return stalePreview();
    } catch {
      return stalePreview();
    }
    return complete(session, idempotencyKey);
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
    const prior = await stateStore.getCompleted(input.idempotencyKey);
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
    const candidate = await getSessionForConfirmation(input.previewId);
    if ('ok' in candidate) return candidate;
    if (
      candidate.kind !== 'change' ||
      !sameValue(candidate.action, input.action)
    )
      return error(
        'PREVIEW_MISMATCH',
        'Confirmation does not match a valid preview.',
      );
    if (now().getTime() > new Date(candidate.expiresAt).getTime())
      return recoverExpiredApplied(candidate, input.idempotencyKey);
    return confirmSession(candidate, input.idempotencyKey);
  };

  const cancel = async (
    previewId: string,
  ): Promise<CommandDeckMutationCancelResult> => {
    const session = await stateStore.getPreview(previewId);
    if (session === undefined)
      return error(
        'PREVIEW_NOT_FOUND',
        'This preview is no longer available. Create a new preview.',
      );
    if (inFlight.has(session.id))
      return error(
        'CONFIRMATION_IN_PROGRESS',
        'A confirmation is already in progress for this preview.',
      );
    if (session.receipt !== undefined)
      return error('PREVIEW_USED', 'This preview was already confirmed.');
    await stateStore.savePreview({ ...session, cancelled: true });
    record({ event: 'cancelled', actionType: session.action.type, previewId });
    return { ok: true };
  };

  const previewRollback = async (
    token: string,
  ): Promise<CommandDeckMutationPreviewResult> => {
    const source = await stateStore.getRollbackSource(token);
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
    const session = await createPreview({
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
    const prior = await stateStore.getCompleted(input.idempotencyKey);
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
    const candidate = await getSessionForConfirmation(input.previewId);
    if ('ok' in candidate) return candidate;
    if (candidate.kind !== 'rollback')
      return error(
        'PREVIEW_MISMATCH',
        'Confirmation does not match a valid rollback preview.',
      );
    if (now().getTime() > new Date(candidate.expiresAt).getTime())
      return recoverExpiredApplied(candidate, input.idempotencyKey);
    return confirmSession(candidate, input.idempotencyKey);
  };

  return { preview, confirm, cancel, previewRollback, confirmRollback };
};

function createMemoryMutationStateStore(): CommandDeckMutationStateStore {
  const previews = new Map<string, CommandDeckMutationStoredPreview>();
  const completed = new Map<string, CommandDeckMutationStoredCompletion>();
  const rollbackSources = new Map<string, string>();

  return {
    savePreview: async (preview) => {
      previews.set(preview.id, cloneStoredPreview(preview));
    },
    getPreview: async (previewId) => {
      const preview = previews.get(previewId);
      return preview === undefined ? undefined : cloneStoredPreview(preview);
    },
    getCompleted: async (idempotencyKey) => {
      const completion = completed.get(idempotencyKey);
      return completion === undefined
        ? undefined
        : {
            previewId: completion.previewId,
            receipt: clone(completion.receipt) as CommandDeckMutationReceipt,
          };
    },
    complete: async (preview, idempotencyKey, receipt) => {
      const existing = completed.get(idempotencyKey);
      if (existing !== undefined)
        return existing.previewId === preview.id
          ? {
              status: 'completed' as const,
              receipt: clone(existing.receipt) as CommandDeckMutationReceipt,
              created: false,
            }
          : { status: 'idempotency_mismatch' as const };
      const storedPreview = previews.get(preview.id);
      if (storedPreview === undefined || storedPreview.receipt !== undefined)
        return { status: 'preview_used' as const };
      const storedReceipt = clone(receipt) as CommandDeckMutationReceipt;
      previews.set(preview.id, {
        ...cloneStoredPreview(storedPreview),
        receipt: storedReceipt,
      });
      completed.set(idempotencyKey, {
        previewId: preview.id,
        receipt: storedReceipt,
      });
      if (storedReceipt.rollbackToken !== undefined)
        rollbackSources.set(storedReceipt.rollbackToken, preview.id);
      return {
        status: 'completed' as const,
        receipt: clone(storedReceipt) as CommandDeckMutationReceipt,
        created: true,
      };
    },
    getRollbackSource: async (rollbackToken) => {
      const previewId = rollbackSources.get(rollbackToken);
      const preview =
        previewId === undefined ? undefined : previews.get(previewId);
      return preview === undefined ? undefined : cloneStoredPreview(preview);
    },
  };
}

function cloneStoredPreview(
  preview: CommandDeckMutationStoredPreview,
): CommandDeckMutationStoredPreview {
  return clone(preview) as CommandDeckMutationStoredPreview;
}
