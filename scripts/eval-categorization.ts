/**
 * Eval simples da categorização: conjunto fixo de estabelecimentos com a categoria esperada.
 * Mede acurácia top-1, custo e latência. Custa dinheiro (poucos centavos com o Haiku) — rode à mão:
 *   ANTHROPIC_API_KEY=… pnpm tsx scripts/eval-categorization.ts            (modelo real, AI_MODEL ou Haiku 5.5)
 *   pnpm tsx scripts/eval-categorization.ts --fake                         (sanidade do harness, sem custo)
 * Meta da Fase 2: ≥ 90% de acerto.
 */
import { readFileSync } from 'node:fs';
import { costMicrosUsd } from '../src/domain/ai/pricing';
import { DEFAULT_CATEGORIES } from '../src/domain/categorization/defaults';
import { FakeAiGateway } from '../src/server/adapters/ai/fake';
import type { AiGateway, CategorizeItem } from '../src/server/adapters/ai/types';

type Case = {
  description: string;
  direction: 'in' | 'out';
  typicalAmount: number;
  channel: 'cartao' | 'conta';
  expected: string;
};
const cases = JSON.parse(readFileSync('tests/evals/categorization.json', 'utf8')) as Case[];

const parents = new Set(DEFAULT_CATEGORIES.filter((c) => c.parent).map((c) => c.parent!));
const categories = DEFAULT_CATEGORIES.filter((c) => !parents.has(c.slug)).map((c) => ({
  slug: c.slug,
  name: c.name,
  kind: c.kind,
  parent: c.parent ? (DEFAULT_CATEGORIES.find((p) => p.slug === c.parent)?.name ?? null) : null,
}));

const fake = process.argv.includes('--fake');
let ai: AiGateway;
if (fake) ai = new FakeAiGateway();
else {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Defina ANTHROPIC_API_KEY (ou use --fake).');
    process.exit(1);
  }
  const { AnthropicAiGateway } = await import('../src/server/adapters/ai/anthropic');
  ai = new AnthropicAiGateway(
    process.env.ANTHROPIC_API_KEY,
    process.env.AI_MODEL ?? 'claude-haiku-5-5',
  );
}

const items: CategorizeItem[] = cases.map((c, i) => ({
  id: `e${i}`,
  description: c.description,
  direction: c.direction,
  typicalAmount: c.typicalAmount,
  occurrences: 3,
  channel: c.channel,
}));
const r = await ai.categorize(items, { categories, examples: [] });
const byId = new Map(r.results.map((x) => [x.id, x]));
let hits = 0;
const misses: string[] = [];
cases.forEach((c, i) => {
  const got = byId.get(`e${i}`);
  if (got?.category === c.expected) hits++;
  else
    misses.push(
      `  ✗ ${c.description}: esperado ${c.expected}, veio ${got?.category ?? '—'} (${Math.round((got?.confidence ?? 0) * 100)}%)`,
    );
});
const acc = hits / cases.length;
console.log(`modelo: ${r.model}`);
console.log(`acurácia: ${hits}/${cases.length} = ${(acc * 100).toFixed(1)}%  (meta ≥ 90%)`);
console.log(
  `custo: US$ ${(costMicrosUsd(r.model, r.usage) / 1e6).toFixed(5)} · latência ${r.latencyMs} ms · tokens ${r.usage.inputTokens}+${r.usage.outputTokens}`,
);
if (misses.length) console.log(misses.join('\n'));
if (!fake && acc < 0.9) process.exit(2);
