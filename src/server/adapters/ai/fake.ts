import { foldText } from '@/domain/text/normalize';
import type {
  AiGateway,
  BatchResultItem,
  CategorizeContext,
  CategorizeItem,
  CategorizeResponse,
  CategorizeResult,
} from './types';

/** Palavra-chave → slug. Determinístico, sem custo — para desenvolvimento e testes. */
const KEYWORDS: [RegExp, string, CategorizeResult['nature']][] = [
  [/IFOOD|IFD|RAPPI|UBER ?EATS/, 'delivery', 'variable_recurring'],
  [/UBER|99 ?POP|CABIFY/, 'apps-transporte', 'variable_recurring'],
  [/MERCADO|EXTRA|CARREFOUR|ASSAI|PAO DE ACUCAR/, 'mercado', 'variable_recurring'],
  [/NETFLIX|SPOTIFY|DISNEY|PRIME VIDEO|MAX\b|YOUTUBE/, 'assinaturas', 'fixed'],
  [/SHELL|IPIRANGA|PETROBRAS|POSTO/, 'combustivel', 'variable_recurring'],
  [/DROGA|DROGASIL|RAIA|PAGUE MENOS|FARMACIA/, 'farmacia', 'variable_recurring'],
  [/PADARIA|CAFE|STARBUCKS/, 'padaria-cafe', 'variable_recurring'],
  [/VIVO|CLARO|TIM\b|OI\b/, 'internet-telefone', 'fixed'],
  [/IMOBILIARIA|ALUGUEL/, 'aluguel', 'fixed'],
  [/AMAZON|MAGALU|MAGAZINE|MERCADO ?LIVRE/, 'compras', 'eventual'],
  [/NOTEBOOK|DELL|APPLE|SAMSUNG/, 'eletronicos', 'eventual'],
  [/SALARIO|FOLHA|PAGTO SAL/, 'salario', 'fixed'],
];

export class FakeAiGateway implements AiGateway {
  readonly model = 'fake-haiku';
  calls = 0;
  batches = new Map<string, { customId: string; items: CategorizeItem[] }[]>();

  private classify(items: CategorizeItem[], ctx: CategorizeContext): CategorizeResult[] {
    const slugs = new Set(ctx.categories.map((c) => c.slug));
    return items.map((i) => {
      const d = foldText(i.description);
      const hit = KEYWORDS.find(([re]) => re.test(d));
      const slug =
        hit && slugs.has(hit[1]) ? hit[1] : i.direction === 'in' ? 'outras-receitas' : 'outros';
      return {
        id: i.id,
        merchant_name: i.description.split(' ').slice(0, 2).join(' '),
        category: slug,
        nature: hit?.[2] ?? 'eventual',
        looks_recurring: hit?.[2] === 'fixed',
        periodicity: hit?.[2] === 'fixed' ? 'monthly' : 'irregular',
        confidence: hit ? 0.92 : 0.4,
        new_category_suggestion: null,
      };
    });
  }

  private usage(items: CategorizeItem[]) {
    return {
      inputTokens: 1500 + items.length * 30,
      outputTokens: items.length * 40,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  }

  async categorize(items: CategorizeItem[], ctx: CategorizeContext): Promise<CategorizeResponse> {
    this.calls++;
    return {
      results: this.classify(items, ctx),
      usage: this.usage(items),
      latencyMs: 1,
      model: this.model,
    };
  }

  async submitCategorizeBatch(
    chunks: { customId: string; items: CategorizeItem[] }[],
    ctx: CategorizeContext,
  ) {
    const id = `fake-batch-${this.batches.size + 1}`;
    this.batches.set(id, chunks);
    this.ctx = ctx;
    return id;
  }

  private ctx: CategorizeContext | undefined;

  async batchEnded() {
    return true;
  }

  async batchResults(batchId: string): Promise<BatchResultItem[]> {
    const chunks = this.batches.get(batchId) ?? [];
    return chunks.map((c) => ({
      customId: c.customId,
      ok: true as const,
      results: this.classify(c.items, this.ctx!),
      usage: this.usage(c.items),
    }));
  }
}
