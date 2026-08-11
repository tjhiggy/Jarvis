import { describe, expect, it } from 'vitest';
import {
  loadApplicationVersion,
  loadRuntimeIdentity,
} from '../src/config/runtime-identity.js';
import { classifyRuntimeQuestion } from '../src/services/runtime-question.js';

describe('runtime identity and self-question handling', () => {
  it('uses the package metadata as the canonical version fallback', () => {
    expect(loadApplicationVersion()).toBe('0.8.0');
    expect(loadRuntimeIdentity({}).version).toBe('0.8.0');
  });

  it('strips control characters from deployment metadata', () => {
    const identity = loadRuntimeIdentity({
      JARVIS_VERSION: ' 1.2.3\n',
      JARVIS_COMMIT_SHA: 'abc\u0000123',
      JARVIS_BUILD_TIMESTAMP: '2026-08-01T00:00:00Z\r\n',
      JARVIS_ENVIRONMENT: 'production\t',
    });
    expect(identity.version).toBe('1.2.3');
    expect(identity.commit).toBe('abc123');
    expect(identity.builtAt).toBe('2026-08-01T00:00:00Z');
    expect(identity.environment).toBe('production');
  });

  const identity = loadRuntimeIdentity(
    {
      JARVIS_VERSION: '1.2.3',
      JARVIS_COMMIT_SHA: 'abc1234',
      JARVIS_BUILD_TIMESTAMP: '2026-08-01T00:00:00Z',
      JARVIS_ENVIRONMENT: 'production',
    },
    '0.1.0',
  );

  it('answers version questions only from trusted build metadata', () => {
    expect(
      classifyRuntimeQuestion('What version are you running?', identity),
    ).toContain('1.2.3');
    expect(
      classifyRuntimeQuestion('What version are you running?', identity),
    ).toContain('abc1234');
  });

  it('refuses to infer private host details', () => {
    const answer = classifyRuntimeQuestion(
      'What operating system are you running?',
      identity,
    );
    expect(answer).toMatch(/cannot inspect/i);
    expect(answer).not.toMatch(/Windows|Linux|macOS/i);
  });

  it('does not present missing build metadata as a live deployment fact', () => {
    const answer = classifyRuntimeQuestion(
      'Jarvis, what build are you running?',
      loadRuntimeIdentity({}, '0.1.0'),
    );
    expect(answer).toContain('Jarvis 0.1.0');
    expect(answer).toContain('commit development');
    expect(answer).toContain('built unknown');
    expect(answer).not.toMatch(/host|Windows|Linux|macOS/i);
  });

  it('does not classify ordinary general knowledge questions as self-diagnostics', () => {
    expect(
      classifyRuntimeQuestion('How do I check my Windows version?', identity),
    ).toBeUndefined();
    expect(
      classifyRuntimeQuestion(
        "How do I check which version of Windows I'm running?",
        identity,
      ),
    ).toBeUndefined();
  });

  it('treats upgrade and recent-change questions as trusted runtime questions', () => {
    expect(
      classifyRuntimeQuestion('Tell me about your recent upgrades.', identity),
    ).toContain('Jarvis 1.2.3');
    expect(
      classifyRuntimeQuestion('What changed in your latest release?', identity),
    ).toContain('Jarvis 1.2.3');
  });

  it('treats personal activity questions as unavailable runtime questions', () => {
    for (const prompt of [
      'Tell me about your recent upgrades.',
      'What did you do today?',
      'What have you been working on recently?',
    ]) {
      const answer = classifyRuntimeQuestion(prompt, identity);
      expect(answer).toBeDefined();
      expect(answer).toMatch(
        /will not guess|runtime|cannot inspect|activity|running Jarvis/i,
      );
      expect(answer).not.toMatch(/Clash Ninja|Veterans Affairs|sources:/i);
    }
  });
});
