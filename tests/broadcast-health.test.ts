import { describe, expect, it } from 'vitest';
import {
  startAdminConsole,
  type AdminConsoleSnapshot,
} from '../src/admin/admin-console.js';

describe('broadcast health projection', () => {
  it('reports a configured category as degraded when its runtime is unavailable', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () =>
        ({
          platform: { version: '0.5.0', environment: 'test' },
          database: 'healthy',
          engagement: { enabled: true, features: [] },
          providers: {
            ai: 'ollama',
            openAiConfigured: false,
            ollamaConfigured: true,
            webSearchConfigured: false,
          },
          integrations: { rss: 'unavailable', sleeper: false, github: false },
          metrics: null,
          broadcasts: {
            categories: [
              {
                category: 'proactive',
                label: 'Crew pulse',
                state: 'enabled',
                destination: '#crew-activity',
                quietHours: 'none',
                cadence: '24 hours',
                health: 'degraded',
                recovery: 'Scheduler is unavailable on this MuthaShip.',
              },
            ],
            last7Days: [],
            last30Days: [],
          },
        }) as unknown as AdminConsoleSnapshot,
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();

    expect(page).toContain('degraded');
    expect(page).toContain('Scheduler is unavailable on this MuthaShip.');
    await console.close();
  });
});
