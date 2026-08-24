import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  startAdminConsole,
  type AdminConsoleSnapshot,
} from '../src/admin/admin-console.js';
import type { CommandDeckReadAuditEvent } from '../src/admin/command-deck-read-api.js';

export interface CommandDeckCutoverReceipt {
  readonly schemaVersion: '1.0';
  readonly scenarios: readonly {
    readonly id: string;
    readonly status: number;
    readonly code: string;
  }[];
  readonly localFallback: boolean;
  readonly liveProjection: boolean;
  readonly redactionPassed: boolean;
}

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultReceiptPath = resolve(
  repositoryRoot,
  '.artifacts/qa/command-deck-cutover.json',
);

export async function runCommandDeckCutoverVerification(
  receiptPath = defaultReceiptPath,
): Promise<CommandDeckCutoverReceipt> {
  const now = new Date('2026-08-24T18:00:00.000Z');
  const canary = 'command-deck-cutover-secret-canary-never-retain';
  const rotatedToken = 'command-deck-cutover-rotated-token-32chars';
  const auditEvents: CommandDeckReadAuditEvent[] = [];
  const responseBodies: unknown[] = [];
  const server = await startAdminConsole({
    port: 0,
    snapshot: async () => disposableSnapshot(canary),
    now: () => now,
    readApi: {
      token: canary,
      allowedOrigins: ['https://deck.example.test'],
      maxClockSkewMs: 60_000,
      replayRetentionMs: 60_000,
      rateLimit: 30,
      rateWindowMs: 60_000,
      audit: (event) => auditEvents.push(event),
    },
  });

  try {
    const address = server.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const origin = `http://127.0.0.1:${port}`;
    const dashboard = await fetch(`${origin}/`);
    const dashboardHtml = await dashboard.text();
    const localFallback =
      dashboard.status === 200 && /command deck/i.test(dashboardHtml);

    const snapshotHeaders = (
      requestId: string,
      overrides: Record<string, string> = {},
    ) => ({
      authorization: `Bearer ${canary}`,
      'x-command-deck-request-id': requestId,
      'x-command-deck-timestamp': now.toISOString(),
      origin: 'https://deck.example.test',
      ...overrides,
    });

    const record = async (
      id: string,
      response: Response,
    ): Promise<{ id: string; status: number; code: string }> => {
      const body = (await response.json()) as {
        error?: { code?: string };
        schemaVersion?: string;
        release?: { version?: string };
      };
      responseBodies.push(body);
      return {
        id,
        status: response.status,
        code: body.error?.code ?? (body.schemaVersion === '1.0' ? 'ok' : 'bad'),
      };
    };

    const snapshotUrl = `${origin}/api/v1/command-deck/snapshot`;
    const scenarios = [
      await record(
        'rotated_token',
        await fetch(snapshotUrl, {
          headers: snapshotHeaders(randomUUID(), {
            authorization: `Bearer ${rotatedToken}`,
          }),
        }),
      ),
      await record(
        'origin_denied',
        await fetch(snapshotUrl, {
          headers: snapshotHeaders(randomUUID(), {
            origin: 'https://evil.example',
          }),
        }),
      ),
      await record(
        'live_snapshot',
        await fetch(snapshotUrl, { headers: snapshotHeaders(randomUUID()) }),
      ),
    ];

    const liveBody = responseBodies[2];
    const liveProjection =
      liveBody !== null &&
      typeof liveBody === 'object' &&
      (liveBody as { schemaVersion?: string }).schemaVersion === '1.0' &&
      (liveBody as { release?: { version?: string } }).release?.version ===
        '1.6.0';

    const evidence = JSON.stringify({
      responseBodies,
      auditEvents,
    });
    const redactionPassed =
      !evidence.includes(canary) &&
      !/private member content|operator:|credentialed\.example|authorization|remoteAddress/i.test(
        evidence,
      );

    const receipt: CommandDeckCutoverReceipt = {
      schemaVersion: '1.0',
      scenarios,
      localFallback,
      liveProjection,
      redactionPassed,
    };
    const serialized = JSON.stringify(receipt, null, 2);
    if (
      !localFallback ||
      !liveProjection ||
      !redactionPassed ||
      serialized.includes(canary) ||
      scenarios[0]?.status !== 401 ||
      scenarios[1]?.status !== 403 ||
      scenarios[2]?.status !== 200
    ) {
      throw new Error(
        'Command Deck cutover verification produced unsafe or incomplete evidence.',
      );
    }
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${serialized}\n`, 'utf8');
    return receipt;
  } finally {
    await server.close();
  }
}

function disposableSnapshot(canary: string): AdminConsoleSnapshot {
  return {
    platform: { version: '1.6.0', environment: 'verification' },
    database: 'healthy',
    engagement: { enabled: true, features: ['trivia'] },
    providers: {
      ai: 'ollama',
      openAiConfigured: false,
      ollamaConfigured: true,
      webSearchConfigured: false,
    },
    integrations: { rss: 'ready', sleeper: true, github: false },
    metrics: { events: 1, failures: 0 },
    token: canary,
    memberId: '123456789012345678',
    message: 'private member content',
    prompt: 'private raw prompt',
    url: `https://operator:${canary}@credentialed.example/feed`,
  } as unknown as AdminConsoleSnapshot;
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const receipt = await runCommandDeckCutoverVerification();
  console.log(
    `Command Deck cutover verification passed ${receipt.scenarios.length} scenarios with local fallback and live projection evidence.`,
  );
}
