import { describe, expect, it } from 'vitest';
import { FeatureFlagService, SUPPORTED_FEATURE_FLAGS } from '../src/engagement/feature-flags.js';

describe('FeatureFlagService', () => {
  it('defaults every supported feature to enabled', async () => {
    const service = new FeatureFlagService({
      getFeatureFlags: async () => [],
      setFeatureFlag: async () => undefined,
    });
    await expect(service.list('ship-1')).resolves.toEqual(
      SUPPORTED_FEATURE_FLAGS.map((name) => ({ name, enabled: true })),
    );
  });

  it('applies persisted overrides without accepting unknown features', async () => {
    const service = new FeatureFlagService({
      getFeatureFlags: async () => [{ name: 'trivia', enabled: false }],
      setFeatureFlag: async () => undefined,
    });
    await expect(service.isEnabled('ship-1', 'trivia')).resolves.toBe(false);
    await expect(service.isEnabled('ship-1', 'unknown' as never)).resolves.toBe(true);
    await expect(service.set('ship-1', 'unknown' as never, false)).rejects.toThrow('Unsupported feature');
  });
});
