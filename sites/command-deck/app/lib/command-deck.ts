export type ServiceState = 'healthy' | 'degraded' | 'stale' | 'unavailable';

export type CommandDeckSnapshot = {
  contractVersion: '1.0';
  generatedAt: string;
  release: { version: string; environment: string; commit: string };
  services: Array<{
    name: string;
    detail: string;
    state: ServiceState;
    metric: string;
  }>;
  activity: { events: number; failures: number; windowDays: number };
};

export const commandDeckFixture: CommandDeckSnapshot = {
  contractVersion: '1.0',
  generatedAt: '2026-08-23T12:12:00-04:00',
  release: { version: '1.5.0', environment: 'Production', commit: 'a585c3e' },
  services: [
    {
      name: 'Discord gateway',
      detail: 'Connected and receiving events',
      state: 'healthy',
      metric: '42 ms',
    },
    {
      name: 'Engagement engine',
      detail: 'Four community features enabled',
      state: 'healthy',
      metric: '4 active',
    },
    {
      name: 'RSS monitor',
      detail: 'One feed needs review',
      state: 'degraded',
      metric: '1 warning',
    },
    {
      name: 'Sleeper Fantasy',
      detail: 'League data ready',
      state: 'healthy',
      metric: 'Ready',
    },
  ],
  activity: { events: 128, failures: 0, windowDays: 7 },
};

export function validateCommandDeckSnapshot(
  value: unknown,
): CommandDeckSnapshot {
  if (!value || typeof value !== 'object')
    throw new Error('Snapshot is required.');
  const snapshot = value as Partial<CommandDeckSnapshot>;
  if (snapshot.contractVersion !== '1.0')
    throw new Error('Unsupported contract version.');
  if (
    !snapshot.release ||
    !Array.isArray(snapshot.services) ||
    !snapshot.activity
  ) {
    throw new Error('Snapshot is incomplete.');
  }
  return snapshot as CommandDeckSnapshot;
}
