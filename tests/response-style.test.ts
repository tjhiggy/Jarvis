import { describe, expect, it } from 'vitest';
import { classifyResponseStyle } from '../src/services/response-style.js';

describe('classifyResponseStyle', () => {
  it.each([
    '- how are you feeling today?',
    'How are you feeling today?',
    'Hello Jarvis',
    'Thanks',
    'Tell me a joke',
    "What's up?",
    "How's it going?",
    'How is your day going?',
    "So what's new with you today?",
    "What's new with you?",
    'Anything new with you today?',
  ])('classifies casual conversation: %s', (prompt) => {
    expect(classifyResponseStyle(prompt)).toBe('concise-casual');
  });

  it.each([
    'What is the weather today?',
    "What's the latest ARC Raiders update?",
    'What is the current Bitcoin price?',
    'Explain this in detail: how are you feeling today?',
  ])('keeps factual or detailed requests standard: %s', (prompt) => {
    expect(classifyResponseStyle(prompt)).toBe('standard');
  });
});
