import { describe, expect, it } from 'vitest';
import {
  evaluateResponse,
  summarizeModelEvaluation,
  modelEvaluationCases,
} from '../src/evaluation/model-evaluation.js';

describe('model evaluation harness', () => {
  it('uses only synthetic, checked-in cases with bounded scoring rules', () => {
    expect(modelEvaluationCases.length).toBeGreaterThanOrEqual(5);
    expect(
      modelEvaluationCases.every((item) => item.prompt.length <= 240),
    ).toBe(true);
    expect(JSON.stringify(modelEvaluationCases)).not.toMatch(
      /discord\.com|<@|token|api[_-]?key/i,
    );
  });

  it('scores correctness, safety, and concise style deterministically', () => {
    const result = evaluateResponse(
      modelEvaluationCases[0]!,
      'RAM means Random Access Memory, the short-term working memory used by a computer.',
      125,
    );
    expect(result).toMatchObject({ passed: true, latencyMs: 125 });
    expect(result.score).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('response');
  });

  it('summarizes aggregate results without retaining prompts or responses', () => {
    const summary = summarizeModelEvaluation('candidate-model', [
      { caseId: 'a', score: 3, passed: true, latencyMs: 100 },
      { caseId: 'b', score: 1, passed: false, latencyMs: 300 },
    ]);
    expect(summary).toEqual({
      model: 'candidate-model',
      cases: 2,
      passed: 1,
      score: 4,
      averageLatencyMs: 200,
    });
    expect(JSON.stringify(summary)).not.toMatch(/prompt|response/i);
  });
});
