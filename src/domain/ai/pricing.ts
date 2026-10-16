/**
 * Preço por milhão de tokens (USD). Fonte: tabela de modelos da Anthropic (cache: 2026-10-06).
 * Haiku 5.5: US$ 0,10 entrada / US$ 0,50 saída (prompts até 100K tokens). Cache: escrita 1,25×, leitura 0,1×.
 * Message Batches: 50% de desconto em tudo.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Custo em milionésimos de dólar (inteiro), para somar sem erro de ponto flutuante. */
export function costMicrosUsd(model: string, u: Usage, batch = false): number {
  const p = MODEL_PRICES[model];
  if (!p) return 0;
  // preço por token em micro-dólares = preço por milhão de tokens
  const micros =
    u.inputTokens * p.input +
    u.cacheWriteTokens * p.input * 1.25 +
    u.cacheReadTokens * p.input * 0.1 +
    u.outputTokens * p.output;
  return Math.round(batch ? micros / 2 : micros);
}
