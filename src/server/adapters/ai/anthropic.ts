import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Usage } from '@/domain/ai/pricing';
import { categorizeSystemPrompt, categorizeUserMessage } from './prompts';
import {
  categorizeResponseSchema,
  type AiGateway,
  type BatchResultItem,
  type CategorizeContext,
  type CategorizeItem,
  type CategorizeResponse,
} from './types';

const MAX_TOKENS = 8000;

function usageOf(u: Anthropic.Usage | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

/** Implementação real com o SDK oficial. Classificação → esforço baixo (Haiku 5.5 tem padrão "medium"). */
export class AnthropicAiGateway implements AiGateway {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  }

  private params(items: CategorizeItem[], ctx: CategorizeContext) {
    return {
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text' as const,
          text: categorizeSystemPrompt(ctx),
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: categorizeUserMessage(items) }],
    };
  }

  async categorize(items: CategorizeItem[], ctx: CategorizeContext): Promise<CategorizeResponse> {
    const started = Date.now();
    const response = await this.client.messages.parse({
      ...this.params(items, ctx),
      output_config: { effort: 'low', format: zodOutputFormat(categorizeResponseSchema) },
    });
    if (response.stop_reason === 'refusal') throw new Error('A IA recusou a solicitação');
    if (response.stop_reason === 'max_tokens')
      throw new Error('Resposta da IA truncada (max_tokens)');
    if (!response.parsed_output) throw new Error('Resposta da IA fora do formato');
    return {
      results: response.parsed_output.items,
      usage: usageOf(response.usage),
      latencyMs: Date.now() - started,
      model: this.model,
    };
  }

  async submitCategorizeBatch(
    chunks: { customId: string; items: CategorizeItem[] }[],
    ctx: CategorizeContext,
  ): Promise<string> {
    const { type, schema } = zodOutputFormat(categorizeResponseSchema);
    const batch = await this.client.messages.batches.create({
      requests: chunks.map((c) => ({
        custom_id: c.customId,
        params: {
          ...this.params(c.items, ctx),
          output_config: { effort: 'low', format: { type, schema } },
        },
      })),
    });
    return batch.id;
  }

  async batchEnded(batchId: string): Promise<boolean> {
    const b = await this.client.messages.batches.retrieve(batchId);
    return b.processing_status === 'ended';
  }

  async batchResults(batchId: string): Promise<BatchResultItem[]> {
    const out: BatchResultItem[] = [];
    for await (const r of await this.client.messages.batches.results(batchId)) {
      if (r.result.type !== 'succeeded') {
        out.push({ customId: r.custom_id, ok: false, error: r.result.type });
        continue;
      }
      const msg = r.result.message;
      const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
      const parsed = text ? categorizeResponseSchema.safeParse(JSON.parse(text)) : null;
      if (!parsed?.success || msg.stop_reason !== 'end_turn') {
        out.push({
          customId: r.custom_id,
          ok: false,
          error: `resposta inválida (${msg.stop_reason})`,
        });
        continue;
      }
      out.push({
        customId: r.custom_id,
        ok: true,
        results: parsed.data.items,
        usage: usageOf(msg.usage),
      });
    }
    return out;
  }
}
