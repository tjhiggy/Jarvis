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
    'So how are you feeling today?',
    'Well, how are you feeling today?',
    'Okay, how are you feeling today?',
    'Hey, how are you feeling today?',
  ])('classifies casual conversation: %s', (prompt) => {
    expect(classifyResponseStyle(prompt)).toBe('concise-casual');
  });

  it.each([
    'What is the weather today?',
    "What's the latest ARC Raiders update?",
    'What is the current Bitcoin price?',
    'Explain this in detail: how are you feeling today?',
    'So what is the weather today?',
    "Hey, what's the latest ARC Raiders update?",
  ])('keeps factual or detailed requests standard: %s', (prompt) => {
    expect(classifyResponseStyle(prompt)).toBe('standard');
  });
});
