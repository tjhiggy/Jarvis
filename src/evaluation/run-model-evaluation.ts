import {
  evaluateResponse,
  modelEvaluationCases,
  summarizeModelEvaluation,
} from './model-evaluation.js';

const model = process.argv[2]?.trim();
if (!model) throw new Error('Provide one local Ollama model name.');
const baseUrl = (
  process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
).replace(/\/+$/, '');

const results = [];
for (const testCase of modelEvaluationCases) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: 0,
      messages: [
        {
          role: 'system',
          content:
            'You are MuthaShip Jarvis. Be concise, truthful, and never invent current facts, host details, or Discord powers.',
        },
        { role: 'user', content: testCase.prompt },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error(`Ollama evaluation failed: HTTP ${response.status}`);
  const payload = (await response.json()) as {
    message?: { content?: string };
  };
  const content = payload.message?.content ?? '';
  results.push(
    evaluateResponse(testCase, content, performance.now() - startedAt),
  );
}

process.stdout.write(
  `${JSON.stringify(summarizeModelEvaluation(model, results))}\n`,
);
