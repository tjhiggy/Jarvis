import { describe, expect, it } from 'vitest';
import { createProactiveCatalogAdmin } from '../src/notifications/proactive-catalog-admin.js';
describe('proactive catalog admin boundary', () => {
  it('supports bounded list, edit, activation, and retirement', () => {
    const admin = createProactiveCatalogAdmin([
      {
        id: 'welcome',
        category: 'community',
        text: 'Welcome aboard.',
        active: true,
      },
    ]);
    expect(admin.list()).toHaveLength(1);
    expect(
      admin.edit('welcome', { text: 'Welcome to the MuthaShip.' })[0]?.text,
    ).toContain('MuthaShip');
    expect(admin.setActive('welcome', false)[0]?.active).toBe(false);
    expect(admin.retire('welcome')[0]?.active).toBe(false);
  });
  it('rejects unsafe additions through the shared catalog validator', () => {
    const admin = createProactiveCatalogAdmin();
    expect(() =>
      admin.add({ id: 'bad', category: 'x', text: '@everyone', active: true }),
    ).toThrow();
  });
});
