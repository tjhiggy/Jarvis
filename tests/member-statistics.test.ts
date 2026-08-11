import { afterEach, describe, expect, it } from 'vitest';
import {
  MemberStatisticsService,
  SQLiteMemberStatisticsStore,
} from '../src/community/member-statistics.js';

describe('opt-in member command statistics', () => {
  const stores: SQLiteMemberStatisticsStore[] = [];
  afterEach(() => stores.splice(0).forEach((store) => store.close()));

  it('does not count commands until the member opts in', async () => {
    const service = createService();
    await service.recordCommand('server-1', 'crew-1', 'ask', now);
    expect(await service.status('server-1', 'crew-1', now)).toEqual({
      enabled: false,
      commandCount: 0,
    });

    await service.enable('server-1', 'crew-1', now);
    await service.recordCommand('server-1', 'crew-1', 'ask', now);
    await service.recordCommand('server-1', 'crew-1', 'search', now);
    expect(await service.status('server-1', 'crew-1', now)).toEqual({
      enabled: true,
      commandCount: 2,
    });
  });

  it('isolates servers and deletes retained statistics on disable', async () => {
    const service = createService();
    await service.enable('server-1', 'crew-1', now);
    await service.enable('server-2', 'crew-1', now);
    expect(await service.optedInCount('server-1')).toBe(1);
    expect(await service.optedInCount('server-2')).toBe(1);
    await service.recordCommand('server-1', 'crew-1', 'ask', now);
    await service.recordCommand('server-2', 'crew-1', 'ask', now);

    await service.disable('server-1', 'crew-1');
    expect(await service.optedInCount('server-1')).toBe(0);
    expect(await service.optedInCount('server-2')).toBe(1);
    expect(await service.status('server-1', 'crew-1', now)).toEqual({
      enabled: false,
      commandCount: 0,
    });
    expect(await service.status('server-2', 'crew-1', now)).toEqual({
      enabled: true,
      commandCount: 1,
    });
  });

  it('removes daily counters outside the 30-day retention window', async () => {
    const service = createService();
    const expired = new Date('2026-07-12T00:00:00.000Z');
    const retained = new Date('2026-07-13T00:00:00.000Z');
    await service.enable('server-1', 'crew-1', expired);
    await service.recordCommand('server-1', 'crew-1', 'ask', expired);
    await service.recordCommand('server-1', 'crew-1', 'ask', retained);

    expect(await service.cleanup(new Date('2026-08-11T00:00:00.000Z'))).toBe(1);
    expect(await service.status('server-1', 'crew-1', now)).toEqual({
      enabled: true,
      commandCount: 1,
    });
  });

  const createService = () => {
    const store = new SQLiteMemberStatisticsStore(':memory:');
    stores.push(store);
    return new MemberStatisticsService(store);
  };
});

const now = new Date('2026-08-11T12:00:00.000Z');
