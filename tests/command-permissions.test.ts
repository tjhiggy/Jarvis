import { describe, expect, it } from 'vitest';
import { commandPermissionRules, formatCommandPermissionRules } from '../src/commands/command-permissions.js';

describe('command permission contract', () => {
  it('documents every privileged command scope without granting Discord authority', () => {
    expect(commandPermissionRules.find((rule) => rule.command.includes('/knowledge approve'))?.scope).toBe('configured-admin');
    expect(commandPermissionRules.find((rule) => rule.command.includes('/poll'))?.scope).toBe('poll-admin-user');
    expect(commandPermissionRules.every((rule) => rule.notes.length > 0)).toBe(true);
  });

  it('formats a safe read-only summary for administrators', () => {
    const summary = formatCommandPermissionRules();
    expect(summary).toContain('ENGAGEMENT_ADMIN_ROLE_IDS');
    expect(summary).toContain('POLL_ADMIN_USER_IDS');
    expect(summary).not.toContain('token');
  });
});
