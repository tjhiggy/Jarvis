import { createHmac, timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';
import { openSqliteDatabase } from '../storage/open-sqlite-database.js';

export const CALEB_HANDOFF_URL = 'http://127.0.0.1:8787/v1/handoff';
export const CALEB_PROFILE_IDENTITY = 'caleb';

export type CalebThreadState = 'active' | 'archived' | 'closed';
export interface CalebProvenance {
  readonly guildId: string;
  readonly chat_id: string;
  readonly channel_id?: string;
  readonly sourceMessageId: string;
  readonly profileIdentity: typeof CALEB_PROFILE_IDENTITY;
  readonly threadState: CalebThreadState;
}
export interface CalebHandoffRequest {
  readonly requestId: string;
  readonly timestamp: number;
  readonly nonce: string;
  readonly message: string;
  readonly provenance: CalebProvenance;
  readonly signature: string;
}
export interface CalebHandoffCapability {
  readonly submit_jarvis_handoff: (input: {
    readonly requestId: string;
    readonly timestamp: number;
    readonly nonce: string;
    readonly message: string;
    readonly provenance: CalebProvenance;
  }) => Promise<{ readonly success: boolean }>;
}
export interface CalebReplayStore {
  claim(requestId: string, nonce: string): Promise<boolean>;
  release?(requestId: string, nonce: string): Promise<void>;
}

export class SQLiteCalebReplayStore implements CalebReplayStore {
  private readonly database: Database.Database;
  private readonly insert: Database.Statement;
  private readonly remove: Database.Statement;
  constructor(databasePath: string) {
    this.database = openSqliteDatabase(databasePath);
    this.database.exec(
      'CREATE TABLE IF NOT EXISTS caleb_handoff_replays (request_id TEXT NOT NULL, nonce TEXT NOT NULL, claimed_at INTEGER NOT NULL, PRIMARY KEY (request_id, nonce))',
    );
    this.insert = this.database.prepare(
      'INSERT OR IGNORE INTO caleb_handoff_replays (request_id, nonce, claimed_at) VALUES (?, ?, ?)',
    );
    this.remove = this.database.prepare(
      'DELETE FROM caleb_handoff_replays WHERE request_id = ? AND nonce = ?',
    );
  }
  async release(requestId: string, nonce: string): Promise<void> {
    this.remove.run(requestId, nonce);
  }
  async claim(requestId: string, nonce: string): Promise<boolean> {
    return this.insert.run(requestId, nonce, Date.now()).changes === 1;
  }
}
export type CalebDiscordResult =
  | { readonly ok: true; readonly message: 'Handoff submitted.' }
  | {
      readonly ok: false;
      readonly message: 'Handoff unavailable.' | 'Request denied.';
    };

const id = /^[A-Za-z0-9._:-]{1,200}$/;
const threadStates = new Set<CalebThreadState>(['active']);
const safeMessage = /^.{1,4000}$/su;

const hasUnsafeControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });

export function normalizeCalebRequest(
  input: CalebHandoffRequest,
): CalebHandoffRequest {
  const provenance = input?.provenance;
  return {
    ...input,
    requestId:
      typeof input?.requestId === 'string' ? input.requestId.trim() : '',
    nonce: typeof input?.nonce === 'string' ? input.nonce.trim() : '',
    signature:
      typeof input?.signature === 'string'
        ? input.signature.trim().toLowerCase()
        : '',
    provenance: {
      ...provenance,
      guildId:
        typeof provenance?.guildId === 'string'
          ? provenance.guildId.trim()
          : '',
      chat_id:
        typeof provenance?.chat_id === 'string'
          ? provenance.chat_id.trim()
          : '',
      channel_id:
        typeof provenance?.channel_id === 'string'
          ? provenance.channel_id.trim()
          : typeof provenance?.chat_id === 'string'
            ? provenance.chat_id.trim()
            : '',
      sourceMessageId:
        typeof provenance?.sourceMessageId === 'string'
          ? provenance.sourceMessageId.trim()
          : '',
      profileIdentity: provenance?.profileIdentity,
      threadState: provenance?.threadState,
    },
  };
}

function canonical(input: Omit<CalebHandoffRequest, 'signature'>): string {
  return JSON.stringify({
    message: input.message,
    nonce: input.nonce,
    provenance: input.provenance,
    requestId: input.requestId,
    timestamp: input.timestamp,
  });
}

export function signCalebHandoff(
  input: Omit<CalebHandoffRequest, 'signature'>,
  secret: string,
): string {
  if (!secret) throw new Error('missing Caleb secret');
  return createHmac('sha256', secret).update(canonical(input)).digest('hex');
}

function validSignature(input: CalebHandoffRequest, secret: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(input.signature) || !secret) return false;
  const unsigned = { ...input };
  delete (unsigned as { signature?: string }).signature;
  const expected = Buffer.from(signCalebHandoff(unsigned, secret), 'hex');
  const actual = Buffer.from(input.signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function validRequest(input: CalebHandoffRequest, now: number): boolean {
  const p = input.provenance;
  return Boolean(
    id.test(input.requestId) &&
    id.test(input.nonce) &&
    safeMessage.test(input.message) &&
    !hasUnsafeControlCharacter(input.message) &&
    Number.isSafeInteger(input.timestamp) &&
    Math.abs(now - input.timestamp) <= 5 * 60_000 &&
    id.test(p.guildId) &&
    id.test(p.chat_id) &&
    id.test(p.channel_id ?? '') &&
    (p.channel_id === undefined || p.chat_id === p.channel_id) &&
    id.test(p.sourceMessageId) &&
    p.profileIdentity === CALEB_PROFILE_IDENTITY &&
    threadStates.has(p.threadState),
  );
}

export function createCalebDiscordAdvisor(options: {
  readonly capability?: CalebHandoffCapability;
  readonly secret?: string;
  readonly now?: () => number;
  readonly disabled?: boolean;
  readonly replayStore?: CalebReplayStore;
}): (request: CalebHandoffRequest) => Promise<CalebDiscordResult> {
  const seen = new Set<string>();
  const inFlight = new Set<string>();
  const now = options.now ?? Date.now;
  const secret = options.secret ?? '';
  return async (request) => {
    const normalized = normalizeCalebRequest(request);
    if (
      options.disabled ||
      !options.capability ||
      !validRequest(normalized, now()) ||
      !validSignature(normalized, secret)
    ) {
      return { ok: false, message: 'Request denied.' };
    }
    const replayKey = `${normalized.requestId}\u0000${normalized.nonce}`;
    if (seen.has(replayKey) || inFlight.has(replayKey))
      return { ok: false, message: 'Request denied.' };
    inFlight.add(replayKey);
    if (
      options.replayStore &&
      !(await options.replayStore.claim(normalized.requestId, normalized.nonce))
    ) {
      inFlight.delete(replayKey);
      return { ok: false, message: 'Request denied.' };
    }
    try {
      const result = await options.capability.submit_jarvis_handoff({
        requestId: normalized.requestId,
        timestamp: normalized.timestamp,
        nonce: normalized.nonce,
        message: normalized.message,
        provenance: normalized.provenance,
      });
      if (!result.success) {
        await options.replayStore?.release?.(
          normalized.requestId,
          normalized.nonce,
        );
        return { ok: false, message: 'Handoff unavailable.' };
      }
      seen.add(replayKey);
      return { ok: true, message: 'Handoff submitted.' };
    } catch {
      await options.replayStore?.release?.(
        normalized.requestId,
        normalized.nonce,
      );
      return { ok: false, message: 'Handoff unavailable.' };
    } finally {
      inFlight.delete(replayKey);
    }
  };
}

export function createLoopbackCalebHandoffClient(options: {
  readonly secret?: string;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly replayStore?: CalebReplayStore;
  readonly now?: () => number;
  readonly disabled?: boolean;
}): (request: CalebHandoffRequest) => Promise<CalebDiscordResult> {
  const endpoint = options.endpoint ?? CALEB_HANDOFF_URL;
  const endpointAllowed = endpoint === CALEB_HANDOFF_URL;
  const transport = options.fetch ?? globalThis.fetch;
  const advisor = createCalebDiscordAdvisor({
    secret: options.secret ?? '',
    ...(options.now ? { now: options.now } : {}),
    ...(options.disabled || !endpointAllowed ? { disabled: true } : {}),
    ...(options.replayStore ? { replayStore: options.replayStore } : {}),
    capability: {
      submit_jarvis_handoff: async ({
        requestId,
        timestamp,
        nonce,
        message,
        provenance,
      }) => {
        const unsigned = { requestId, timestamp, nonce, message, provenance };
        const response = await transport(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-caleb-signature': signCalebHandoff(
              unsigned,
              options.secret ?? '',
            ),
          },
          body: JSON.stringify({
            ...unsigned,
            signature: signCalebHandoff(
              unsigned,
              options.secret ?? process.env.CALEB_SECRET ?? '',
            ),
          }),
        });
        if (!response.ok) return { success: false };
        const payload: unknown = await response.json();
        return {
          success:
            typeof payload === 'object' &&
            payload !== null &&
            !Array.isArray(payload) &&
            (payload as { success?: unknown }).success === true,
        };
      },
    },
  });
  return async (request) => {
    const secret = options.secret ?? '';
    if (!secret) return { ok: false, message: 'Request denied.' };
    const unsigned = { ...request, signature: undefined as never };
    return advisor({
      ...request,
      signature: request.signature || signCalebHandoff(unsigned, secret),
    });
  };
}
