import {
  createAnalyticsEvent,
  type AnalyticsEvent,
  type InteractionContext,
} from './contracts.js';

export interface AnalyticsSink {
  record(event: AnalyticsEvent): void | Promise<void>;
}

export class Instrumentation {
  constructor(private readonly sink: AnalyticsSink) {}

  async run<T>(input: {
    readonly context: InteractionContext;
    readonly feature: string;
    readonly command?: string;
    readonly operation: () => Promise<T>;
  }): Promise<T> {
    const startedAt = Date.now();
    await this.record({
      name: 'command_started',
      context: input.context,
      feature: input.feature,
      ...(input.command === undefined ? {} : { command: input.command }),
      result: 'success',
    });
    try {
      const value = await input.operation();
      await this.record({
        name: 'command_succeeded',
        context: input.context,
        feature: input.feature,
        ...(input.command === undefined ? {} : { command: input.command }),
        result: 'success',
        durationMs: Date.now() - startedAt,
      });
      return value;
    } catch (error) {
      await this.record({
        name: 'command_failed',
        context: input.context,
        feature: input.feature,
        ...(input.command === undefined ? {} : { command: input.command }),
        result: 'failure',
        durationMs: Date.now() - startedAt,
        metadata: {
          errorType: error instanceof Error ? error.name : 'unknown',
        },
      });
      throw error;
    }
  }

  async cancel(input: {
    readonly context: InteractionContext;
    readonly feature: string;
    readonly command?: string;
    readonly reason?: string;
  }): Promise<void> {
    await this.record({
      name: 'command_cancelled',
      context: input.context,
      feature: input.feature,
      ...(input.command === undefined ? {} : { command: input.command }),
      result: 'cancelled',
      ...(input.reason === undefined
        ? {}
        : { metadata: { reasonCode: 'provided' } }),
    });
  }

  private async record(
    input: Parameters<typeof createAnalyticsEvent>[0],
  ): Promise<void> {
    try {
      await this.sink.record(createAnalyticsEvent(input));
    } catch {
      // Analytics must never change command behavior or expose sink failures.
    }
  }
}
