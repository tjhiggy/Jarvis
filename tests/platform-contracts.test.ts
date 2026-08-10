import { describe, expect, it } from 'vitest';
import {
  createAnalyticsEvent,
  createAuditEvent,
  createAuthorizationPolicy,
  type AnalyticsEvent,
  type InteractionContext,
  type PlatformModule,
} from '../src/platform/contracts.js';
import { Instrumentation } from '../src/platform/instrumentation.js';
import { PlatformModuleRegistry } from '../src/platform/registry.js';

describe('platform contracts', () => {
  const context: InteractionContext = {
    serverId: 'server-1',
    channelId: 'channel-1',
    userId: 'user-1',
    correlationId: 'corr-1',
    surface: 'discord',
    isAdministrator: false,
  };

  it('creates bounded analytics events without message content or secrets', () => {
    const event = createAnalyticsEvent({
      name: 'command_succeeded',
      context,
      feature: 'rss',
      command: 'rss add',
      result: 'success',
      durationMs: 42,
      metadata: {
        prompt: 'private message content',
        token: 'secret-token',
        safe: 'kept',
      },
    });

    expect(event).toMatchObject({
      name: 'command_succeeded',
      serverId: 'server-1',
      channelId: 'channel-1',
      feature: 'rss',
      command: 'rss add',
      result: 'success',
      durationMs: 42,
      metadata: { safe: 'kept' },
    });
    expect(JSON.stringify(event)).not.toMatch(/private message|secret-token|prompt|token/i);
  });

  it('creates server-scoped audit events with bounded metadata', () => {
    const event = createAuditEvent({
      context,
      operation: 'feature_pause',
      result: 'success',
      metadata: { feature: 'rss', apiKey: 'never-store-this' },
    });

    expect(event).toMatchObject({
      serverId: 'server-1',
      actorId: 'user-1',
      operation: 'feature_pause',
      result: 'success',
      metadata: { feature: 'rss' },
    });
    expect(JSON.stringify(event)).not.toMatch(/apiKey|never-store-this/i);
  });

  it('describes a module without coupling it to Discord or a provider', () => {
    const module: PlatformModule = {
      id: 'rss',
      version: '1.0.0',
      capabilities: ['command', 'scheduled-delivery'],
      register: () => undefined,
      health: async () => ({ state: 'healthy', details: {} }),
    };

    expect(module.id).toBe('rss');
    expect(module.capabilities).toContain('scheduled-delivery');
    expect(module.register()).toBeUndefined();
  });

  it('enforces administrator policy without granting server-management powers', () => {
    const policy = createAuthorizationPolicy('administrator');
    expect(policy.authorize(context)).toBe(false);
    expect(policy.authorize({ ...context, isAdministrator: true })).toBe(true);
  });

  it('registers modules once and returns a stable module list', () => {
    const registry = new PlatformModuleRegistry();
    const module: PlatformModule = {
      id: 'rss',
      version: '1.0.0',
      capabilities: ['command'],
      register: () => undefined,
      health: async () => ({ state: 'healthy', details: {} }),
    };
    registry.register(module);
    expect(registry.get('rss')).toBe(module);
    expect(registry.list()).toEqual([module]);
    expect(() => registry.register(module)).toThrow(/already registered/i);
  });

  it('records safe start and success events while preserving the operation result', async () => {
    const events: AnalyticsEvent[] = [];
    const instrumentation = new Instrumentation({ record: (event) => { events.push(event); } });
    await expect(instrumentation.run({
      context,
      feature: 'rss',
      command: 'rss list',
      operation: async () => 'ok',
    })).resolves.toBe('ok');
    expect(events.map((event) => event.name)).toEqual([
      'command_started',
      'command_succeeded',
    ]);
    expect(events[1]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records a failure event and rethrows the original failure', async () => {
    const events: AnalyticsEvent[] = [];
    const instrumentation = new Instrumentation({ record: (event) => { events.push(event); } });
    const failure = new Error('private provider detail');
    await expect(instrumentation.run({
      context,
      feature: 'rss',
      command: 'rss add',
      operation: async () => { throw failure; },
    })).rejects.toBe(failure);
    expect(events.map((event) => event.name)).toEqual([
      'command_started',
      'command_failed',
    ]);
    expect(JSON.stringify(events)).not.toContain('private provider detail');
  });
});
