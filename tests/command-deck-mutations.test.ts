import { describe, expect, it } from 'vitest';
import {
  createCommandDeckMutationService,
  type CommandDeckMutationAdapter,
  type CommandDeckMutationAction,
} from '../src/admin/command-deck-mutations.js';

class InMemoryMutationAdapter implements CommandDeckMutationAdapter {
  readonly allowedBroadcastCategories = ['recap'] as const;
  readonly supportedFeatureFlags = ['welcomePrompts'] as const;
  readonly allowedRssHosts = ['news.example.test'] as const;

  readonly applied: Array<{
    action: CommandDeckMutationAction;
    value: unknown;
  }> = [];

  private readonly values = new Map<string, unknown>();

  failNextApply = false;

  set(action: CommandDeckMutationAction, value: unknown): void {
    this.values.set(this.keyFor(action), value);
  }

  async read(action: CommandDeckMutationAction): Promise<unknown> {
    return this.values.get(this.keyFor(action));
  }

  async apply(
    action: CommandDeckMutationAction,
    value: unknown,
  ): Promise<void> {
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new Error('The local Jarvis adapter is unavailable.');
    }

    this.applied.push({ action, value });
    this.values.set(this.keyFor(action), value);
  }

  targetFor(action: CommandDeckMutationAction): string {
    switch (action.type) {
      case 'broadcast_state':
        return `Broadcast: ${action.category}`;
      case 'feature_flag':
        return `Feature: ${action.feature}`;
      case 'rss_feed':
        return `RSS: ${action.url}`;
    }
  }

  private keyFor(action: CommandDeckMutationAction): string {
    switch (action.type) {
      case 'broadcast_state':
        return `broadcast:${action.category}`;
      case 'feature_flag':
        return `feature:${action.feature}`;
      case 'rss_feed':
        return `rss:${action.url}`;
    }
  }
}

const recapPause: CommandDeckMutationAction = {
  type: 'broadcast_state',
  category: 'recap',
  state: 'paused',
};

describe('Command Deck mutation service', () => {
  it('previews an exact before and after diff for an allowlisted action', async () => {
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
        idempotencyKey: '4ac50d35-e4f3-44dd-93da-dbf790928edc',
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'PREVIEW_STALE',
        message:
          'This preview has expired. Create a new preview before confirming.',
      },
    });
    expect(adapter.applied).toEqual([]);
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
        idempotencyKey: '9cb3db14-78a3-4fd9-8e7a-1f0fa90f5085',
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'PREVIEW_CANCELLED',
        message: 'This preview was cancelled and cannot be confirmed.',
      },
    });
    expect(adapter.applied).toEqual([]);
  });

  it('returns the original receipt for duplicate confirmation without reapplying', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);

    if (!preview.ok) throw new Error('Expected preview to succeed.');
    const request = {
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: '27549b17-897c-4128-9b54-028a3d73c1d7',
    };
    const first = await service.confirm(request);
    const duplicate = await service.confirm(request);

    expect(first).toMatchObject({
      ok: true,
      receipt: { rollbackToken: expect.any(String) },
    });
    expect(duplicate).toEqual(first);
    expect(adapter.applied).toEqual([{ action: recapPause, value: false }]);
  });

  it('keeps a failed confirmation retryable with the same idempotency key', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    adapter.failNextApply = true;
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);

    if (!preview.ok) throw new Error('Expected preview to succeed.');
    const request = {
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: 'df2f1e05-32f5-4a7f-bf56-b3e13d1d6982',
    };

    await expect(service.confirm(request)).resolves.toEqual({
      ok: false,
      error: {
        code: 'APPLY_FAILED',
        message:
          'Jarvis could not apply this change. Retry the same confirmation.',
      },
    });
    await expect(service.confirm(request)).resolves.toMatchObject({ ok: true });
    expect(adapter.applied).toEqual([{ action: recapPause, value: false }]);
  });

  it('refuses rollback when the target changed after confirmation', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);

    if (!preview.ok) throw new Error('Expected preview to succeed.');
    const confirmation = await service.confirm({
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: '6cd0ea2c-8670-47ee-a7a8-3c2138733cd7',
    });

    if (!confirmation.ok || confirmation.receipt.rollbackToken === undefined) {
      throw new Error('Expected confirmation with a rollback token.');
    }
    adapter.set(recapPause, true);

    await expect(
      service.rollback(confirmation.receipt.rollbackToken),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'ROLLBACK_CONFLICT',
        message:
          'Rollback was not applied because the target changed after this confirmation.',
      },
    });
    expect(adapter.applied).toEqual([{ action: recapPause, value: false }]);
  });

  it('rejects actions that carry fields outside the bounded control contract', async () => {
    const adapter = new InMemoryMutationAdapter();
    const service = createCommandDeckMutationService({ adapter });

    await expect(
      service.preview({ ...recapPause, discordServerSetting: 'unsafe' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_ACTION',
        message:
          'This Command Deck action is not supported for this Jarvis installation.',
      },
    });
  });

  it('does not let an audit sink failure disrupt a preview', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({
      adapter,
      audit: () => {
        throw new Error('audit storage unavailable');
      },
    });

    await expect(service.preview(recapPause)).resolves.toMatchObject({
      ok: true,
      preview: { diff: { before: true, after: false } },
    });
  });

  it('keeps a failed rollback retryable while its token remains valid', async () => {
    const adapter = new InMemoryMutationAdapter();
    adapter.set(recapPause, true);
    const service = createCommandDeckMutationService({ adapter });
    const preview = await service.preview(recapPause);

    if (!preview.ok) throw new Error('Expected preview to succeed.');
    const confirmation = await service.confirm({
      previewId: preview.preview.id,
      action: recapPause,
      idempotencyKey: 'fa5bc8df-a2be-4f31-a149-6f9b88cbb85e',
    });

    if (!confirmation.ok) throw new Error('Expected confirmation to succeed.');
    adapter.failNextApply = true;

    await expect(
      service.rollback(confirmation.receipt.rollbackToken),
    ).resolves.toMatchObject({ ok: false, error: { code: 'ROLLBACK_FAILED' } });
    await expect(
      service.rollback(confirmation.receipt.rollbackToken),
    ).resolves.toMatchObject({ ok: true });
    expect(adapter.applied).toEqual([
      { action: recapPause, value: false },
      { action: recapPause, value: true },
    ]);
  });
});
