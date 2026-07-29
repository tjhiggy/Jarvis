import { describe, expect, it } from 'vitest';
import {
  neutralizeDiscordMentions,
  removeBotMention,
} from '../src/utils/mentions.js';

describe('removeBotMention', () => {
  it('removes an exact standard bot mention and trims the remaining content', () => {
    expect(removeBotMention('<@123> status', '123')).toBe('status');
  });

  it('removes an exact nickname bot mention and leaves an empty result', () => {
    expect(removeBotMention('<@!123>   ', '123')).toBe('');
  });

  it('preserves non-matching mentions and surrounding text', () => {
    expect(removeBotMention('check <@456> and <@1234>', '123')).toBe(
      'check <@456> and <@1234>',
    );
  });

  it('removes every exact bot mention without treating its ID as regex source', () => {
    expect(removeBotMention('<@12.3> ping <@!12.3>', '12.3')).toBe('ping');
  });
});

describe('neutralizeDiscordMentions', () => {
  it('prevents mass, user, role, and channel pings while preserving visible text', () => {
    expect(
      neutralizeDiscordMentions(
        '@everyone @here <@123> <@!123> <@&456> <#789>',
      ),
    ).toBe(
      '@\u200beveryone @\u200bhere <@\u200b123> <@\u200b!123> <@\u200b&456> <#\u200b789>',
    );
  });

  it('neutralizes @here case-insensitively without changing ordinary at-signs', () => {
    expect(neutralizeDiscordMentions('@HERE email@example.com')).toBe(
      '@\u200bHERE email@example.com',
    );
  });
});
