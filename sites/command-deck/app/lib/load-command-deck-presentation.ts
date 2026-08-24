import {
  commandDeckFixture,
  presentCommandDeckReadSnapshot,
  resolveCommandDeckApiBaseUrl,
  unavailableCommandDeckSnapshot,
  type CommandDeckPresentationSource,
  type CommandDeckSnapshot,
} from './command-deck';

export type CommandDeckPresentation = {
  snapshot: CommandDeckSnapshot;
  source: CommandDeckPresentationSource;
};

const snapshotPath = '/api/v1/command-deck/snapshot';

const createRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  throw new Error('A Command Deck request ID could not be created.');
};

export async function loadCommandDeckPresentation(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<CommandDeckPresentation> {
  const apiBaseUrl = resolveCommandDeckApiBaseUrl(
    env.COMMAND_DECK_API_BASE_URL,
  );
  const token = env.COMMAND_DECK_READ_TOKEN?.trim() ?? '';
  const pageOrigin = env.COMMAND_DECK_PAGE_ORIGIN?.trim() ?? '';
  if (
    apiBaseUrl === undefined ||
    token.length < 32 ||
    !/^https:\/\/[^/\s?#]+$/i.test(pageOrigin)
  ) {
    return { snapshot: commandDeckFixture, source: 'sample' };
  }

  try {
    const response = await fetchImpl(`${apiBaseUrl}${snapshotPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: pageOrigin,
        'X-Command-Deck-Request-Id': createRequestId(),
        'X-Command-Deck-Timestamp': new Date().toISOString(),
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      return {
        snapshot: unavailableCommandDeckSnapshot,
        source: 'unavailable',
      };
    }
    return {
      snapshot: presentCommandDeckReadSnapshot(await response.json()),
      source: 'live',
    };
  } catch {
    return { snapshot: unavailableCommandDeckSnapshot, source: 'unavailable' };
  }
}
