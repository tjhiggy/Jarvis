import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeCatalog,
  redactKnowledgeText,
} from '../src/knowledge/approved-knowledge.js';
import { SQLiteKnowledgeApprovalStore } from '../src/knowledge/knowledge-store.js';

describe('approved knowledge', () => {
  it('redacts secrets, mass mentions, and email addresses before indexing', () => {
    expect(
      redactKnowledgeText(
        'Token sk-live-abcdefghijklmnopqrstuvwxyz @everyone contact crew@example.com',
      ),
    ).toBe('Token [REDACTED] [REDACTED] contact [REDACTED]');
  });

  it('returns only approved, non-expired entries and preserves source attribution', () => {
    const catalog = buildKnowledgeCatalog(
      [
        {
          id: 'rules',
          title: 'Crew rules',
          content: 'Be excellent.',
          source: 'captains-quarters',
          approved: true,
          updatedAt: '2026-08-01T00:00:00Z',
          retentionDays: 30,
        },
        {
          id: 'pending',
          title: 'Pending',
          content: 'Not searchable.',
          source: 'draft',
          approved: false,
          updatedAt: '2026-08-01T00:00:00Z',
        },
        {
          id: 'old',
          title: 'Old',
          content: 'Expired.',
          source: 'archive',
          approved: true,
          updatedAt: '2026-01-01T00:00:00Z',
          retentionDays: 1,
        },
      ],
      new Date('2026-08-09T00:00:00Z'),
    );
    expect(catalog.search('rules')).toEqual([
      {
        id: 'rules',
        title: 'Crew rules',
        content: 'Be excellent.',
        source: 'captains-quarters',
        updatedAt: '2026-08-01T00:00:00Z',
      },
    ]);
    expect(catalog.search('pending')).toEqual([]);
    expect(catalog.search('old')).toEqual([]);
  });

  it('ranks multi-token matches deterministically without requiring an exact phrase', () => {
    const catalog = buildKnowledgeCatalog(
      [
        {
          id: 'events',
          title: 'Crew event guide',
          content: 'Create game nights and collect RSVP responses.',
          source: 'operator-guide',
          approved: true,
          updatedAt: '2026-08-01T00:00:00Z',
        },
        {
          id: 'games',
          title: 'Game library',
          content: 'A list of games played by the crew.',
          source: 'games-list',
          approved: true,
          updatedAt: '2026-08-01T00:00:00Z',
        },
      ],
      new Date('2026-08-09T00:00:00Z'),
    );

    expect(catalog.search('game RSVP').map(({ id }) => id)).toEqual([
      'events',
      'games',
    ]);
  });

  it('lists pending and expired sources with approval status for administrators', async () => {
    const catalog = buildKnowledgeCatalog(
      [
        {
          id: 'active',
          title: 'Active',
          content: 'A',
          source: 'ops',
          approved: true,
          updatedAt: '2026-08-01T00:00:00Z',
          retentionDays: 30,
        },
        {
          id: 'pending',
          title: 'Pending',
          content: 'P',
          source: 'draft',
          approved: false,
          updatedAt: '2026-08-01T00:00:00Z',
        },
        {
          id: 'expired',
          title: 'Expired',
          content: 'E',
          source: 'old',
          approved: true,
          updatedAt: '2026-01-01T00:00:00Z',
          retentionDays: 1,
        },
      ],
      new Date('2026-08-09T00:00:00Z'),
    );
    const store = new SQLiteKnowledgeApprovalStore(':memory:');
    await expect(store.listForAdmin('crew', catalog)).resolves.toEqual([
      { id: 'active', title: 'Active', approved: true, active: true },
      { id: 'pending', title: 'Pending', approved: false, active: false },
      { id: 'expired', title: 'Expired', approved: true, active: false },
    ]);
    store.close();
  });
});
