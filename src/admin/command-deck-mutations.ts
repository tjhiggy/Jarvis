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

export interface CommandDeckMutationAdapter {
  readonly allowedBroadcastCategories: readonly string[];
  readonly supportedFeatureFlags: readonly string[];
  readonly allowedRssHosts: readonly string[];
  read(action: CommandDeckMutationAction): Promise<unknown>;
  apply(action: CommandDeckMutationAction, value: unknown): Promise<void>;
  targetFor(action: CommandDeckMutationAction): string;
}

export interface CommandDeckMutationAuditEvent {
  readonly event:
    | 'previewed'
    | 'cancelled'
    | 'confirmed'
    | 'confirmation_failed'
    | 'rolled_back'
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
  readonly rollbackToken: string;
}

type ErrorCode =
  | 'INVALID_ACTION'
  | 'PREVIEW_NOT_FOUND'
  | 'PREVIEW_STALE'
  | 'PREVIEW_CANCELLED'
  | 'PREVIEW_MISMATCH'
  | 'PREVIEW_USED'
  | 'IDEMPOTENCY_MISMATCH'
  | 'APPLY_FAILED'
  | 'ROLLBACK_NOT_FOUND'
  | 'ROLLBACK_CONFLICT'
  | 'ROLLBACK_FAILED'
  | 'ROLLBACK_USED';

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

export type CommandDeckMutationRollbackResult =
  | { readonly ok: true; readonly receipt: CommandDeckMutationReceipt }
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
  readonly action: CommandDeckMutationAction;
  readonly before: unknown;
  readonly after: unknown;
  readonly preview: CommandDeckMutationPreview;
  cancelled: boolean;
  confirmed: boolean;
}

interface Confirmation {
  readonly previewId: string;
  readonly action: CommandDeckMutationAction;
  readonly receipt: CommandDeckMutationReceipt;
}

const previewLifetimeMilliseconds = 5 * 60 * 1000;

const error = (code: ErrorCode, message: string) => ({
  ok: false as const,
  error: { code, message },
});

const clone = (value: unknown): unknown => structuredClone(value);

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const sameAction = (
  left: CommandDeckMutationAction,
  right: CommandDeckMutationAction,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean => Object.keys(value).every((key) => allowedKeys.includes(key));

const hasOnlyText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const isAction = (value: unknown): value is CommandDeckMutationAction => {
  if (!isRecord(value) || !hasOnlyText(value.type)) return false;

  if (value.type === 'broadcast_state') {
    return (
      hasOnlyKeys(value, ['type', 'category', 'state']) &&
      hasOnlyText(value.category) &&
      (value.state === 'enabled' || value.state === 'paused')
    );
  }

  if (value.type === 'feature_flag') {
    return (
      hasOnlyKeys(value, ['type', 'feature', 'enabled']) &&
      hasOnlyText(value.feature) &&
      typeof value.enabled === 'boolean'
    );
  }

  if (value.type === 'rss_feed') {
    return (
      hasOnlyKeys(value, ['type', 'operation', 'url', 'label']) &&
      (value.operation === 'add' || value.operation === 'remove') &&
      hasOnlyText(value.url) &&
      (value.label === undefined || hasOnlyText(value.label))
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
  const confirmations = new Map<string, Confirmation>();
  const rollbacks = new Map<string, Confirmation>();

  const record = (event: CommandDeckMutationAuditEvent): void => {
    if (audit === undefined) return;
    try {
      void Promise.resolve(audit(event)).catch(() => undefined);
    } catch {
      // Audit delivery must never change the outcome of a bounded mutation.
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

  const preview = async (
    input: unknown,
  ): Promise<CommandDeckMutationPreviewResult> => {
    if (!isAction(input) || !validates(input)) {
      return error(
        'INVALID_ACTION',
        'This Command Deck action is not supported for this Jarvis installation.',
      );
    }

    const before = clone(await adapter.read(input));
    const action = clone(input) as CommandDeckMutationAction;
    const id = createId();
    const previewAt = now();
    const mutationPreview: CommandDeckMutationPreview = {
      id,
      expiresAt: new Date(
        previewAt.getTime() + previewLifetimeMilliseconds,
      ).toISOString(),
      target: adapter.targetFor(action),
      diff: { before, after: clone(desiredValue(action)) },
    };
    previews.set(id, {
      action,
      before,
      after: mutationPreview.diff.after,
      preview: mutationPreview,
      cancelled: false,
      confirmed: false,
    });
    record({ event: 'previewed', actionType: action.type, previewId: id });
    return { ok: true, preview: mutationPreview };
  };

  const confirm = async (
    input: unknown,
  ): Promise<CommandDeckMutationConfirmResult> => {
    if (
      !isRecord(input) ||
      !hasOnlyText(input.previewId) ||
      !hasOnlyText(input.idempotencyKey)
    ) {
      return error(
        'PREVIEW_MISMATCH',
        'Confirmation does not match a valid preview.',
      );
    }
    if (!isAction(input.action)) {
      return error(
        'PREVIEW_MISMATCH',
        'Confirmation does not match a valid preview.',
      );
    }

    const existingConfirmation = confirmations.get(input.idempotencyKey);
    if (existingConfirmation !== undefined) {
      return existingConfirmation.previewId === input.previewId &&
        sameAction(existingConfirmation.action, input.action)
        ? { ok: true, receipt: existingConfirmation.receipt }
        : error(
            'IDEMPOTENCY_MISMATCH',
            'This idempotency key belongs to a different confirmation.',
          );
    }

    const session = previews.get(input.previewId);
    if (session === undefined) {
      return error(
        'PREVIEW_NOT_FOUND',
        'This preview is no longer available. Create a new preview.',
      );
    }
    if (session.cancelled) {
      return error(
        'PREVIEW_CANCELLED',
        'This preview was cancelled and cannot be confirmed.',
      );
    }
    if (now().getTime() > new Date(session.preview.expiresAt).getTime()) {
      return error(
        'PREVIEW_STALE',
        'This preview has expired. Create a new preview before confirming.',
      );
    }
    if (!sameAction(session.action, input.action)) {
      return error(
        'PREVIEW_MISMATCH',
        'Confirmation does not match a valid preview.',
      );
    }
    if (session.confirmed) {
      return error('PREVIEW_USED', 'This preview was already confirmed.');
    }

    try {
      await adapter.apply(session.action, clone(session.after));
    } catch {
      record({
        event: 'confirmation_failed',
        actionType: session.action.type,
        previewId: input.previewId,
      });
      return error(
        'APPLY_FAILED',
        'Jarvis could not apply this change. Retry the same confirmation.',
      );
    }

    session.confirmed = true;
    const receipt: CommandDeckMutationReceipt = {
      id: createId(),
      confirmedAt: now().toISOString(),
      target: session.preview.target,
      rollbackToken: createId(),
    };
    const confirmation = {
      previewId: input.previewId,
      action: session.action,
      receipt,
    };
    confirmations.set(input.idempotencyKey, confirmation);
    rollbacks.set(receipt.rollbackToken, confirmation);
    record({
      event: 'confirmed',
      actionType: session.action.type,
      previewId: input.previewId,
      receiptId: receipt.id,
    });
    return { ok: true, receipt };
  };

  const cancel = async (
    previewId: string,
  ): Promise<CommandDeckMutationCancelResult> => {
    const session = previews.get(previewId);
    if (session === undefined) {
      return error(
        'PREVIEW_NOT_FOUND',
        'This preview is no longer available. Create a new preview.',
      );
    }
    if (session.confirmed) {
      return error('PREVIEW_USED', 'This preview was already confirmed.');
    }
    session.cancelled = true;
    record({ event: 'cancelled', actionType: session.action.type, previewId });
    return { ok: true };
  };

  const rollback = async (
    token: string,
  ): Promise<CommandDeckMutationRollbackResult> => {
    const confirmation = rollbacks.get(token);
    if (confirmation === undefined) {
      return error(
        'ROLLBACK_NOT_FOUND',
        'This rollback token is not available.',
      );
    }
    const session = previews.get(confirmation.previewId);
    if (session === undefined) {
      return error(
        'ROLLBACK_NOT_FOUND',
        'This rollback token is not available.',
      );
    }

    const current = await adapter.read(session.action);
    if (!sameValue(current, session.after)) {
      record({
        event: 'rollback_conflict',
        actionType: session.action.type,
        previewId: confirmation.previewId,
        receiptId: confirmation.receipt.id,
      });
      return error(
        'ROLLBACK_CONFLICT',
        'Rollback was not applied because the target changed after this confirmation.',
      );
    }

    try {
      await adapter.apply(session.action, clone(session.before));
    } catch {
      return error(
        'ROLLBACK_FAILED',
        'Jarvis could not apply this rollback. Retry the rollback.',
      );
    }

    rollbacks.delete(token);
    record({
      event: 'rolled_back',
      actionType: session.action.type,
      previewId: confirmation.previewId,
      receiptId: confirmation.receipt.id,
    });
    return { ok: true, receipt: confirmation.receipt };
  };

  return { preview, confirm, cancel, rollback };
};
