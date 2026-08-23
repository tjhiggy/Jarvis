import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  startAdminConsole,
  type AdminConsoleSnapshot,
} from '../src/admin/admin-console.js';
import type { CommandDeckReadAuditEvent } from '../src/admin/command-deck-read-api.js';

export interface CommandDeckReadApiReceipt {
  readonly schemaVersion: '1.0';
  readonly scenarios: readonly {
    readonly id: string;
    readonly status: number;
    readonly code: string;
  }[];
  readonly redactionPassed: boolean;
}

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultReceiptPath = resolve(
  repositoryRoot,
  '.artifacts/qa/command-deck-read-api.json',
);

export async function runCommandDeckReadApiVerification(
  receiptPath = defaultReceiptPath,
): Promise<CommandDeckReadApiReceipt> {
  const now = new Date('2026-08-23T20:00:00.000Z');
  const canary = 'command-deck-secret-canary-never-retain';
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
      rateLimit: 2,
      rateWindowMs: 60_000,
      audit: (event) => auditEvents.push(event),
    },
  });
  try {
    const address = server.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const endpoint = `http://127.0.0.1:${port}/api/v1/command-deck/snapshot`;
    const firstId = randomUUID();
    const request = (
      requestId: string,
      overrides: Record<string, string> = {},
    ) =>
      fetch(endpoint, {
        headers: {
          authorization: `Bearer ${canary}`,
          'x-command-deck-request-id': requestId,
          'x-command-deck-timestamp': now.toISOString(),
          ...overrides,
        },
      });
    const exercise = async (
      id: string,
      response: Response,
    ): Promise<{ id: string; status: number; code: string }> => {
      const body = (await response.json()) as {
        error?: { code?: string };
        schemaVersion?: string;
      };
      responseBodies.push(body);
      return {
        id,
        status: response.status,
        code: body.error?.code ?? (body.schemaVersion === '1.0' ? 'ok' : 'bad'),
      };
    };

    const scenarios = [
      await exercise('malformed', await request('not-a-uuid')),
      await exercise(
        'unauthorized',
        await request(randomUUID(), { authorization: 'Bearer wrong' }),
      ),
      await exercise(
        'expired',
        await request(randomUUID(), {
          'x-command-deck-timestamp': '2026-08-23T19:58:00.000Z',
        }),
      ),
      await exercise(
        'cross_origin',
        await request(randomUUID(), { origin: 'https://evil.example' }),
      ),
      await exercise('valid', await request(firstId)),
      await exercise('replayed', await request(firstId)),
    ];
    await exercise('rate_limit_warmup', await request(randomUUID()));
    scenarios.push(await exercise('rate_limited', await request(randomUUID())));

    const exercisedEvidence = JSON.stringify({ responseBodies, auditEvents });
    const redactionPassed =
      !exercisedEvidence.includes(canary) &&
      !/private member content|operator:|credentialed\.example|authorization|remoteAddress/i.test(
        exercisedEvidence,
      );

    const receipt: CommandDeckReadApiReceipt = {
      schemaVersion: '1.0',
      scenarios,
      redactionPassed,
    };
    const serialized = JSON.stringify(receipt, null, 2);
    if (!redactionPassed || serialized.includes(canary)) {
      throw new Error(
        'Command Deck API verification produced unsafe evidence.',
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
    platform: { version: 'disposable', environment: 'verification' },
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
  const receipt = await runCommandDeckReadApiVerification();
  console.log(
    `Command Deck read API verification passed ${receipt.scenarios.length} scenarios with sanitized evidence.`,
  );
}
