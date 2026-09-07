import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { startAdminConsole } from '../src/admin/admin-console.js';
import {
  CAPTAINS_QUARTERS_CHANNEL_ID,
  handleRequestCommand,
} from '../src/commands/request.js';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import * as restBoundary from '../src/providers/rest-boundary.js';
import * as webhookBoundary from '../src/providers/webhook-boundary.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');
const handoffName = /\b(?:caleb|handoff)\b/i;
const handoffEnvKey = /\b(?:CALEB|HANDOFF)_[A-Z0-9_]+\b/;
const createTableName =
  /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi;

const faqFixture = [
  {
    id: 'capabilities',
    label: 'Capabilities',
    question: 'What can Jarvis do?',
    answer: 'Synthetic answer.',
  },
];

describe('Caleb to Jarvis handoff lifecycle', () => {
  it('has no production Caleb or handoff receipt identifiers', () => {
    const matches = scanFiles(
      [
        ...listFiles(sourceRoot, '.ts'),
        ...listFiles(join(repositoryRoot, 'scripts'), '.ts'),
        join(repositoryRoot, '.env.example'),
      ],
      (content) =>
        uniqueMatches(content, handoffName).concat(
          uniqueMatches(content, handoffEnvKey),
        ),
    );

    expect(matches).toEqual([]);
  });

  it('keeps webhook and REST boundaries outbound-only', () => {
    expect(Object.keys(webhookBoundary).sort()).toEqual([
      'isWebhookHostAllowed',
      'validateWebhookPolicy',
    ]);
    expect(Object.keys(restBoundary).sort()).toEqual([
      'isRestHostAllowed',
      'validateRestRequestPolicy',
    ]);

    const unsigned = webhookBoundary.validateWebhookPolicy({
      allowedHosts: ['hooks.example.test'],
      timeoutMs: 5000,
      maxBytes: 100_000,
      requireSignature: false,
    });
    expect(unsigned.requireSignature).toBe(false);

    const rest = restBoundary.validateRestRequestPolicy({
      allowedHosts: ['api.example.test'],
      timeoutMs: 5000,
      maxBytes: 100_000,
      allowMethods: ['GET', 'HEAD'],
    });
    expect(rest.allowMethods).toEqual(['GET', 'HEAD']);
    expect(() =>
      restBoundary.validateRestRequestPolicy({
        allowedHosts: ['api.example.test'],
        timeoutMs: 5000,
        maxBytes: 100_000,
        allowMethods: ['POST'] as never,
      }),
    ).toThrow(/unsupported REST method/i);
  });

  it('rejects candidate handoff HTTP paths on the Command Deck', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => ({
        platform: { version: '1.6.0', environment: 'test' },
        database: 'healthy',
        engagement: { enabled: false, features: [] },
        providers: {
          ai: 'ollama',
          openAiConfigured: false,
          ollamaConfigured: false,
          webSearchConfigured: false,
        },
        integrations: { rss: 'ready', sleeper: false, github: false },
        metrics: null,
      }),
      readApi: {
        token: 'dedicated-read-token-with-enough-entropy',
        allowedOrigins: [],
        maxClockSkewMs: 60_000,
        replayRetentionMs: 60_000,
        rateLimit: 30,
        rateWindowMs: 60_000,
      },
      now: () => new Date('2026-08-23T20:00:00.000Z'),
    });

    try {
      const base = consoleUrl(console);
      const headers = {
        authorization: 'Bearer dedicated-read-token-with-enough-entropy',
        'content-type': 'application/json',
        'x-command-deck-request-id': 'c248ad5f-1b62-4ed0-8caa-ab516cf9ea19',
        'x-command-deck-timestamp': '2026-08-23T20:00:00.000Z',
      };
      const candidates = [
        { method: 'POST', path: '/api/handoff' },
        { method: 'GET', path: '/api/handoff' },
        { method: 'POST', path: '/api/caleb' },
        { method: 'POST', path: '/api/v1/handoff' },
        { method: 'POST', path: '/api/v1/caleb/receipt' },
        { method: 'GET', path: '/api/v1/command-deck/handoff' },
        { method: 'POST', path: '/api/v1/command-deck/config/handoff' },
      ] as const;

      const responses = await Promise.all(
        candidates.map(async (candidate) => {
          const init: RequestInit =
            candidate.method === 'POST'
              ? {
                  method: candidate.method,
                  headers,
                  body: JSON.stringify({
                    source: 'caleb',
                    request: 'persist this handoff',
                  }),
                }
              : { method: candidate.method, headers };
          const response = await fetch(`${base}${candidate.path}`, init);
          return {
            path: candidate.path,
            method: candidate.method,
            status: response.status,
            body: await response.text(),
          };
        }),
      );

      expect(responses.every((item) => item.status === 404)).toBe(true);
      const configHandoff = responses.find(
        (item) => item.path === '/api/v1/command-deck/config/handoff',
      );
      expect(JSON.parse(configHandoff?.body ?? '{}')).toMatchObject({
        schemaVersion: '1.0',
        error: { code: 'not_found', message: 'Request denied.' },
      });
      expect(
        responses
          .filter((item) => item.path !== '/api/v1/command-deck/config/handoff')
          .every((item) => item.body === 'Not found'),
      ).toBe(true);
    } finally {
      await console.close();
    }
  });

  it('creates no durable Caleb or handoff tables in production SQL', () => {
    const tables = scanFiles(listFiles(sourceRoot, '.ts'), (content) => {
      const names: string[] = [];
      for (const match of content.matchAll(createTableName)) {
        const table = match[1];
        if (table !== undefined) names.push(table);
      }
      return names;
    });

    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((table) => /caleb|handoff/i.test(table.name))).toEqual(
      [],
    );
  });

  it('does not register a Caleb or handoff Discord command', () => {
    const names = createCommandDefinitions(2_000, faqFixture, true).map(
      (definition) => definition.name,
    );

    expect(names).toContain('request');
    expect(names.some((name) => handoffName.test(name))).toBe(false);
  });

  it('keeps /request approval-gated and without a local handoff store', async () => {
    const createIssue = vi.fn();
    const reply = vi.fn().mockResolvedValue(undefined);

    await handleRequestCommand(
      requestInteraction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: false,
        reply,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/administrator/i),
        ephemeral: true,
      }),
    );

    const wrongChannelReply = vi.fn().mockResolvedValue(undefined);
    await handleRequestCommand(
      requestInteraction({
        channelId: 'other-channel',
        admin: true,
        reply: wrongChannelReply,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).not.toHaveBeenCalled();
    expect(wrongChannelReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/captains-quarters/i),
        ephemeral: true,
      }),
    );
  });

  it('keeps extension contracts disabled pending operator approval', () => {
    const contracts = readFileSync(
      join(sourceRoot, 'extensions', 'contracts.ts'),
      'utf8',
    );

    expect(contracts).toMatch(/enabled:\s*false/);
    expect(contracts).toContain("reason: 'operator approval required'");
    expect(contracts).toMatch(/Deliberately inert extension shapes/);
    expect(handoffName.test(contracts)).toBe(false);
  });
});

function listFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function scanFiles(
  files: readonly string[],
  extract: (content: string) => readonly string[],
): readonly { readonly file: string; readonly name: string }[] {
  return files.flatMap((file) =>
    extract(readFileSync(file, 'utf8')).map((name) => ({
      file: relative(repositoryRoot, file).replaceAll('\\', '/'),
      name,
    })),
  );
}

function uniqueMatches(content: string, pattern: RegExp): string[] {
  const flags = pattern.flags.includes('g')
    ? pattern.flags
    : `${pattern.flags}g`;
  return [
    ...new Set(
      [...content.matchAll(new RegExp(pattern.source, flags))].map(
        (match) => match[0],
      ),
    ),
  ];
}

function consoleUrl(console: Awaited<ReturnType<typeof startAdminConsole>>) {
  const address = console.server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

function requestInteraction(input: {
  readonly channelId: string;
  readonly admin: boolean;
  readonly reply: (payload: unknown) => Promise<unknown>;
}) {
  return {
    guildId: 'guild-1',
    channelId: input.channelId,
    member: {
      roles: {
        cache: {
          has: (role: string) => input.admin && role === 'admin-role',
        },
      },
    },
    options: {
      getString: (name: string) => {
        if (name === 'what') return 'Refresh the FAQ';
        if (name === 'why') return 'Members keep asking the same questions.';
        if (name === 'done') return 'FAQ answers match the current ship rules.';
        return null;
      },
    },
    reply: input.reply,
  };
}
