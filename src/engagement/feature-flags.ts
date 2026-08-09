export const SUPPORTED_FEATURE_FLAGS = [
  'introductions',
  'suggestions',
  'events',
  'trivia',
  'birthdays',
  'roles',
  'proactive',
  'recaps',
] as const;

export type FeatureFlagName = (typeof SUPPORTED_FEATURE_FLAGS)[number];
export interface FeatureFlagRecord { readonly name: FeatureFlagName; readonly enabled: boolean }
export interface FeatureFlagRepository {
  getFeatureFlags(guildId: string): Promise<readonly FeatureFlagRecord[]>;
  setFeatureFlag(guildId: string, name: FeatureFlagName, enabled: boolean, updatedAt?: Date): Promise<void>;
}

export class FeatureFlagService {
  constructor(private readonly repository: FeatureFlagRepository) {}
  async list(guildId: string): Promise<readonly FeatureFlagRecord[]> {
    const persisted = new Map((await this.repository.getFeatureFlags(guildId)).map((entry) => [entry.name, entry.enabled]));
    return SUPPORTED_FEATURE_FLAGS.map((name) => ({ name, enabled: persisted.get(name) ?? true }));
  }
  async isEnabled(guildId: string, name: FeatureFlagName): Promise<boolean> {
    if (!SUPPORTED_FEATURE_FLAGS.includes(name)) return true;
    const entry = (await this.repository.getFeatureFlags(guildId)).find((value) => value.name === name);
    return entry?.enabled ?? true;
  }
  async set(guildId: string, name: FeatureFlagName, enabled: boolean): Promise<void> {
    if (!SUPPORTED_FEATURE_FLAGS.includes(name)) throw new Error(`Unsupported feature: ${name}`);
    await this.repository.setFeatureFlag(guildId, name, enabled, new Date());
  }
}
