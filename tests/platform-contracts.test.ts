import { describe, expect, it } from 'vitest';
import {
  createAnalyticsEvent,
  createAuditEvent,
  createAuthorizationPolicy,
  type InteractionContext,
  type PlatformModule,
} from '../src/platform/contracts.js';

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
    expect(JSON.stringify(event)).not.toMatch(
      /private message|secret-token|prompt|token/i,
    );
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
});
