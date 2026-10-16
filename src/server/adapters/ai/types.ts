import { z } from 'zod';
import type { Usage } from '@/domain/ai/pricing';

export const NATURES = ['fixed', 'variable_recurring', 'eventual'] as const;
export const PERIODICITIES = ['weekly', 'monthly', 'yearly', 'irregular'] as const;

/** Um estabelecimento (descrição normalizada) a categorizar — nunca uma transação com dados pessoais. */
export type CategorizeItem = {
  id: string;
  description: string;
  direction: 'in' | 'out';
  /** valor típico em reais (mediana), arredondado */
  typicalAmount: number;
  occurrences: number;
  channel: 'cartao' | 'conta';
};

export type CategoryOption = {
  slug: string;
  name: string;
  kind: 'expense' | 'income';
  parent: string | null;
};
export type CategorizeContext = {
  categories: CategoryOption[];
  examples: { description: string; slug: string }[];
};

/** Formato pedido ao modelo (validado de novo por nós — o enum vira só uma dica no JSON Schema). */
export const categorizeResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      merchant_name: z.string(),
      category: z.string(),
      nature: z.enum(NATURES),
      looks_recurring: z.boolean(),
      periodicity: z.enum(PERIODICITIES),
      confidence: z.number().min(0).max(1),
      new_category_suggestion: z.string().nullable(),
    }),
  ),
});
export type CategorizeResult = z.infer<typeof categorizeResponseSchema>['items'][number];

export type CategorizeResponse = {
  results: CategorizeResult[];
  usage: Usage;
  latencyMs: number;
  model: string;
};

export type BatchResultItem =
  | { customId: string; ok: true; results: CategorizeResult[]; usage: Usage }
  | { customId: string; ok: false; error: string };

export interface AiGateway {
  readonly model: string;
  categorize(items: CategorizeItem[], ctx: CategorizeContext): Promise<CategorizeResponse>;
  submitCategorizeBatch(
    chunks: { customId: string; items: CategorizeItem[] }[],
    ctx: CategorizeContext,
  ): Promise<string>;
  batchEnded(batchId: string): Promise<boolean>;
  batchResults(batchId: string): Promise<BatchResultItem[]>;
}
