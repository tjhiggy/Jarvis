import { describe, expect, it } from 'vitest';
import { buildKnowledgeCatalog, redactKnowledgeText } from '../src/knowledge/approved-knowledge.js';

describe('approved knowledge', () => {
  it('redacts secrets, mass mentions, and email addresses before indexing', () => {
    expect(redactKnowledgeText('Token sk-live-abcdefghijklmnopqrstuvwxyz @everyone contact crew@example.com'))
      .toBe('Token [REDACTED] [REDACTED] contact [REDACTED]');
  });

  it('returns only approved, non-expired entries and preserves source attribution', () => {
    const catalog = buildKnowledgeCatalog([
      { id: 'rules', title: 'Crew rules', content: 'Be excellent.', source: 'captains-quarters', approved: true, updatedAt: '2026-08-01T00:00:00Z', retentionDays: 30 },
      { id: 'pending', title: 'Pending', content: 'Not searchable.', source: 'draft', approved: false, updatedAt: '2026-08-01T00:00:00Z' },
      { id: 'old', title: 'Old', content: 'Expired.', source: 'archive', approved: true, updatedAt: '2026-01-01T00:00:00Z', retentionDays: 1 },
    ], new Date('2026-08-09T00:00:00Z'));
    expect(catalog.search('rules')).toEqual([{ id: 'rules', title: 'Crew rules', content: 'Be excellent.', source: 'captains-quarters', updatedAt: '2026-08-01T00:00:00Z' }]);
    expect(catalog.search('pending')).toEqual([]);
    expect(catalog.search('old')).toEqual([]);
  });
});
