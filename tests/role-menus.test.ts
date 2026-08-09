import { describe, expect, it } from 'vitest';
import { parseRoleMenuConfig, roleMenuSelection } from '../src/engagement/role-menus.js';

describe('self-service role menus', () => {
  it('parses bounded configured role choices', () => {
    const menus = parseRoleMenuConfig('games:Games:123456789012345678,pc:PC:234567890123456789');
    expect(menus).toEqual([
      { value: 'games', label: 'Games', roleId: '123456789012345678' },
      { value: 'pc', label: 'PC', roleId: '234567890123456789' },
    ]);
  });

  it('rejects malformed or duplicate role choices', () => {
    expect(() => parseRoleMenuConfig('games:Games:not-a-role')).toThrow();
    expect(() => parseRoleMenuConfig('games:Games:123456789012345678,games:Other:234567890123456789')).toThrow();
  });

  it('returns the selected role and rejects unknown values', () => {
    const menus = parseRoleMenuConfig('games:Games:123456789012345678');
    expect(roleMenuSelection(menus, 'games')).toEqual(menus[0]);
    expect(roleMenuSelection(menus, 'unknown')).toBeUndefined();
  });
});
