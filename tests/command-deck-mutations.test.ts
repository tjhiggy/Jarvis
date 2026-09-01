import { describe, expect, it } from 'vitest';
import { commandDeckRssFeedId } from '../src/admin/command-deck-rss-feed.js';
import {
  createCommandDeckMutationService,
  type CommandDeckMutationAction,
  type CommandDeckMutationAdapter,
  type CommandDeckMutationApplyRequest,
} from '../src/admin/command-deck-mutations.js';

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

class InMemoryMutationAdapter implements CommandDeckMutationAdapter {
  readonly allowedBroadcastCategories = ['recap'] as const;
  readonly supportedFeatureFlags = ['welcomePrompts'] as const;
  readonly allowedRssHosts = ['news.example.test'] as const;
  readonly attempts: CommandDeckMutationApplyRequest[] = [];

  failNextApply = false;
  applyThenTimeout = false;
  operationStatusThrows = false;
  operationStatusOverride: 'applied' | 'not_applied' | undefined = undefined;

  private readonly values = new Map<string, unknown>();
  private readonly operations = new Map<string, 'applied' | 'not_applied'>();
  private deferred:
    | {
        started: () => void;
        release: () => void;
        startedPromise: Promise<void>;
        releasePromise: Promise<void>;
      }
    | undefined;

  set(action: CommandDeckMutationAction, value: unknown): void {
    this.values.set(this.keyFor(action), structuredClone(value));
  }

  async read(action: CommandDeckMutationAction): Promise<unknown> {
    return structuredClone(this.values.get(this.keyFor(action)));
  }

  async apply(
    request: CommandDeckMutationApplyRequest,
  ): Promise<'applied' | 'already_applied' | 'precondition_failed'> {
    if (this.deferred !== undefined) {
      const deferred = this.deferred;
      this.deferred = undefined;
      deferred.started();
      await deferred.releasePromise;
    }
    if (this.operations.get(request.operationId) === 'applied') {
      return 'already_applied';
    }
    if (
      canonical(this.values.get(this.keyFor(request.action))) !==
      canonical(request.expectedValue)
    ) {
      return 'precondition_failed';
    }
    if (this.failNextApply) {
      this.failNextApply = false;
      this.operations.set(request.operationId, 'not_applied');
      throw new Error('The local Jarvis adapter is unavailable.');
    }

    this.attempts.push(structuredClone(request));
    this.values.set(
      this.keyFor(request.action),
      structuredClone(request.nextValue),
    );
    this.operations.set(request.operationId, 'applied');
    if (this.applyThenTimeout) {
      this.applyThenTimeout = false;
      throw new Error('The adapter timed out after applying the operation.');
    }
    return 'applied';
  }

  async operationStatus(
    operationId: string,
  ): Promise<'applied' | 'not_applied'> {
    if (this.operationStatusThrows) {
      throw new Error('The local Jarvis adapter is unavailable.');
    }
    return (
      this.operationStatusOverride ??
      this.operations.get(operationId) ??
      'not_applied'
    );
  }

  deferNextApply(): { waitForStart: () => Promise<void>; release: () => void } {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.deferred = { started, release, startedPromise, releasePromise };
    return { waitForStart: () => startedPromise, release };
  }

  targetFor(action: CommandDeckMutationAction): string {
    switch (action.type) {
      case 'broadcast_state':
        return `Broadcast: ${action.category}`;
      case 'feature_flag':
        return `Feature: ${action.feature}`;
      case 'rss_feed':
        return `RSS: ${action.operation === 'add' ? action.url : action.feedId}`;
    }
  }

  private keyFor(action: CommandDeckMutationAction): string {
    switch (action.type) {
      case 'broadcast_state':
        return `broadcast:${action.category}`;
      case 'feature_flag':
        return `feature:${action.feature}`;
      case 'rss_feed':
        return `rss:${action.operation === 'add' ? action.url : action.feedId}`;
    }
  }
}

const recapPause: CommandDeckMutationAction = {
  type: 'broadcast_state',
  category: 'recap',
  state: 'paused',
};
const rssRemove: CommandDeckMutationAction = {
  type: 'rss_feed',
  operation: 'remove',
  feedId: 'rss_0123456789abcdef0123456789abcdef',
};

describe('Command Deck mutation service', () => {
  it('previews an exact, private before and after diff', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({
      adapter,
      now: () => new Date('2026-08-23T12:00:00.000Z'),
    });

    await expect(service.preview(recapPause)).resolves.toMatchObject({
      ok: true,
      preview: {
        target: 'Broadcast: recap',
        diff: { before: true, after: false },
        expiresAt: '2026-08-23T12:05:00.000Z',
      },
    });
  });

  it('rejects a stale preview without applying the action', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    let now = new Date('2026-08-23T12:00:00.000Z');
    const service = createCommandDeckMutationService({
      adapter,
      now: () => now,
    });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');
    now = new Date('2026-08-23T12:05:00.001Z');

    await expect(
      service.confirm({
        previewId: preview.preview.id,
        action: recapPause,
        idempotencyKey: 'stale',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'PREVIEW_STALE' } });
    expect(adapter.attempts).toEqual([]);
  });

  it('cancels an unused preview and prevents confirmation', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');

    await expect(service.cancel(preview.preview.id)).resolves.toEqual({
      ok: true,
    });
    await expect(
      service.confirm({
        previewId: preview.preview.id,
        action: recapPause,
        idempotencyKey: 'cancelled',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PREVIEW_CANCELLED' },
    });
  });

  it('serializes duplicate confirmation and rejects a different in-flight idempotency key', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');
    const gate = adapter.deferNextApply();
    const request = {
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: 'same-key',
    };
    const first = service.confirm(request);
    await gate.waitForStart();
    const duplicate = service.confirm(request);

    await expect(
      service.confirm({ ...request, idempotencyKey: 'different-key' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_IN_PROGRESS' },
    });
    await expect(service.cancel(preview.preview.id)).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_IN_PROGRESS' },
    });
    gate.release();

    await expect(duplicate).resolves.toEqual(await first);
    expect(adapter.attempts).toHaveLength(1);
  });

  it('uses adapter operation status to recover an apply-then-timeout without duplicating the effect', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    adapter.applyThenTimeout = true;
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');
    const request = {
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: 'ambiguous',
    };

    const first = await service.confirm(request);
    const retry = await service.confirm(request);

    expect(first).toMatchObject({ ok: true });
    expect(retry).toEqual(first);
    expect(adapter.attempts).toHaveLength(1);
  });

  it('keeps a known failed confirmation retryable with the same operation id', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    adapter.failNextApply = true;
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');
    const request = {
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: 'retry',
    };

    await expect(service.confirm(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'APPLY_FAILED' },
    });
    await expect(service.confirm(request)).resolves.toMatchObject({ ok: true });
    expect(adapter.attempts).toHaveLength(1);
  });

  it('keeps preview snapshots private when callers mutate returned diff objects', async () => {
    const adapter = new InMemoryMutationAdapter();
    const originalFeed = {
      url: 'https://news.example.test/feed.xml',
      label: 'Original feed',
    };
    adapter.set(rssRemove, originalFeed);
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(rssRemove);
    if (!preview.ok) throw new Error('Expected preview to succeed.');
    (preview.preview.diff.before as { label: string }).label =
      'Tampered preview';

    const confirmation = await service.confirm({
      previewId: preview.preview.id,
      action: rssRemove,
      idempotencyKey: 'private-snapshots',
    });
    if (!confirmation.ok) throw new Error('Expected confirmation to succeed.');
    if (confirmation.receipt.rollbackToken === undefined) {
      throw new Error('Expected a rollback token.');
    }
    const rollbackPreview = await service.previewRollback(
      confirmation.receipt.rollbackToken,
    );
    if (!rollbackPreview.ok)
      throw new Error('Expected rollback preview to succeed.');
    (rollbackPreview.preview.diff.after as { label: string }).label =
      'Tampered rollback preview';

    await expect(
      service.confirmRollback({
        previewId: rollbackPreview.preview.id,
        idempotencyKey: 'private-rollback',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await adapter.read(rssRemove)).toEqual(originalFeed);
  });

  it('requires rollback preview and confirmation, then fails atomically if the target changes before write', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');
    const confirmation = await service.confirm({
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: 'rollback-source',
    });
    if (!confirmation.ok) throw new Error('Expected confirmation to succeed.');
    if (confirmation.receipt.rollbackToken === undefined) {
      throw new Error('Expected a rollback token.');
    }

    const rollbackPreview = await service.previewRollback(
      confirmation.receipt.rollbackToken,
    );
    if (!rollbackPreview.ok)
      throw new Error('Expected rollback preview to succeed.');
    adapter.set(recapPause, true);

    await expect(
      service.confirmRollback({
        previewId: rollbackPreview.preview.id,
        idempotencyKey: 'rollback-confirmation',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PRECONDITION_FAILED' },
    });
    expect(await adapter.read(recapPause)).toBe(true);
  });

  it('matches logically equivalent action objects regardless of JSON key order', async () => {
    const adapter = new InMemoryMutationAdapter();
    const action: CommandDeckMutationAction = {
      type: 'rss_feed',
      operation: 'add',
      url: 'https://news.example.test/feed.xml',
      label: 'Official feed',
    };
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(action);
    if (!preview.ok) throw new Error('Expected preview to succeed.');

    await expect(
      service.confirm({
        previewId: preview.preview.id,
        action: {
          label: 'Official feed',
          url: 'https://news.example.test/feed.xml',
          operation: 'add',
          type: 'rss_feed',
        },
        idempotencyKey: 'ordered-differently',
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects actions outside the bounded control contract and isolates audit failures', async () => {
    const adapter = new InMemoryMutationAdapter();
    const service = createCommandDeckMutationService({
      adapter,
      audit: () => {
        throw new Error('audit storage unavailable');
      },
    });

    await expect(
      service.preview({ ...recapPause, discordServerSetting: 'unsafe' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_ACTION' } });
    await expect(service.preview(recapPause)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('projects RSS add previews as a feed ID and trimmed label without the URL', async () => {
    const adapter = new InMemoryMutationAdapter();
    const url = 'https://news.example.test/feed.xml';
    const action: CommandDeckMutationAction = {
      type: 'rss_feed',
      operation: 'add',
      url,
      label: ' Official feed ',
    };
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(action);
    if (!preview.ok) throw new Error('Expected preview to succeed.');

    expect(preview.preview.diff).toEqual({
      before: undefined,
      after: {
        feedId: commandDeckRssFeedId(url),
        label: 'Official feed',
      },
    });
    expect(JSON.stringify(preview.preview.diff)).not.toContain(url);
    expect(adapter.attempts).toEqual([]);
  });

  it.each([
    [
      'a blank RSS label',
      {
        type: 'rss_feed',
        operation: 'add',
        url: 'https://news.example.test/feed.xml',
        label: '   ',
      },
    ],
    [
      'a malformed RSS URL',
      {
        type: 'rss_feed',
        operation: 'add',
        url: 'not a url',
        label: 'Official feed',
      },
    ],
  ])(
    'rejects %s at preview without applying a mutation',
    async (_label, action) => {
      const adapter = new InMemoryMutationAdapter();
      const service = createCommandDeckMutationService({ adapter });

      await expect(service.preview(action)).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_ACTION' },
      });
      expect(adapter.attempts).toEqual([]);
    },
  );

  it('rejects confirmation of an unknown preview without applying', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });

    await expect(
      service.confirm({
        previewId: 'missing-preview',
        action: recapPause,
        idempotencyKey: 'unknown',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PREVIEW_NOT_FOUND' },
    });
    expect(adapter.attempts).toEqual([]);
  });

  it('rejects a confirmation whose action does not match the preview', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');

    await expect(
      service.confirm({
        previewId: preview.preview.id,
        action: { type: 'broadcast_state', category: 'rss', state: 'paused' },
        idempotencyKey: 'mismatch',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PREVIEW_MISMATCH' },
    });
    expect(adapter.attempts).toEqual([]);
  });

  it('rejects reuse of an idempotency key against a different preview', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });
    const firstPreview = await service.preview(recapPause);
    if (!firstPreview.ok) throw new Error('Expected preview to succeed.');
    await expect(
      service.confirm({
        previewId: firstPreview.preview.id,
        action: recapPause,
        idempotencyKey: 'shared-key',
      }),
    ).resolves.toMatchObject({ ok: true });

    adapter.set(recapPause, true);
    const secondPreview = await service.preview(recapPause);
    if (!secondPreview.ok) throw new Error('Expected preview to succeed.');
    await expect(
      service.confirm({
        previewId: secondPreview.preview.id,
        action: recapPause,
        idempotencyKey: 'shared-key',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'IDEMPOTENCY_MISMATCH' },
    });
    expect(adapter.attempts).toHaveLength(1);
  });

  it('reports an unknown apply outcome when adapter status cannot be read', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    adapter.failNextApply = true;
    adapter.operationStatusThrows = true;
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');

    await expect(
      service.confirm({
        previewId: preview.preview.id,
        action: recapPause,
        idempotencyKey: 'unknown-outcome',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'APPLY_OUTCOME_UNKNOWN' },
    });
    expect(adapter.attempts).toEqual([]);
  });

  it('completes an expired preview when the adapter already applied the operation', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    let now = new Date('2026-08-23T12:00:00.000Z');
    const service = createCommandDeckMutationService({
      adapter,
      now: () => now,
    });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');
    now = new Date('2026-08-23T12:05:00.001Z');
    adapter.operationStatusOverride = 'applied';

    const confirmation = await service.confirm({
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: 'expired-applied',
    });

    expect(confirmation).toMatchObject({ ok: true });
    expect(adapter.attempts).toEqual([]);
  });

  it('keeps an expired preview stale when adapter status cannot be read', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    let now = new Date('2026-08-23T12:00:00.000Z');
    const service = createCommandDeckMutationService({
      adapter,
      now: () => now,
    });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');
    now = new Date('2026-08-23T12:05:00.001Z');
    adapter.operationStatusThrows = true;

    await expect(
      service.confirm({
        previewId: preview.preview.id,
        action: recapPause,
        idempotencyKey: 'expired-unknown',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PREVIEW_STALE' },
    });
    expect(adapter.attempts).toEqual([]);
  });

  it('rejects an unknown rollback token without reading the target', async () => {
    const adapter = new InMemoryMutationAdapter();
    const service = createCommandDeckMutationService({ adapter });

    await expect(
      service.previewRollback('missing-token'),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ROLLBACK_NOT_FOUND' },
    });
  });

  it('refuses rollback preview when the target changed after confirmation', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);
    if (!preview.ok) throw new Error('Expected preview to succeed.');
    const confirmation = await service.confirm({
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: 'rollback-conflict-source',
    });
    if (!confirmation.ok) throw new Error('Expected confirmation to succeed.');
    if (confirmation.receipt.rollbackToken === undefined) {
      throw new Error('Expected a rollback token.');
    }
    adapter.set(recapPause, true);

    await expect(
      service.previewRollback(confirmation.receipt.rollbackToken),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ROLLBACK_CONFLICT' },
    });
  });
});
