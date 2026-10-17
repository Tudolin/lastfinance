import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';

export type AgentRequest = {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.Beta.BetaMessageParam[];
  onText: (delta: string) => void;
  signal?: AbortSignal;
};

export interface AgentModel {
  readonly model: string;
  turn(req: AgentRequest): Promise<Anthropic.Beta.BetaMessage>;
}

/**
 * Modelo real, com streaming. Prompt e ferramentas ficam no prefixo cacheado; o cache automático
 * cobre o histórico. Se o modelo recusar, a API tenta de novo num modelo de reserva na mesma chamada.
 */
export class AnthropicAgentModel implements AgentModel {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
  }

  async turn({ system, tools, messages, onText, signal }: AgentRequest) {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
      },
      { signal },
    );
    stream.on('text', onText);
    return stream.finalMessage();
  }
}

let model: AgentModel | null | undefined;

/** Assistente disponível? Sem chave (e fora do modo fake), a tela explica como ativar. */
export async function getAgentModel(): Promise<AgentModel | null> {
  if (model !== undefined) return model;
  const e = env();
  if (e.AI_FAKE) {
    const { FakeAgentModel } = await import('./fake-model');
    return (model = new FakeAgentModel());
  }
  if (!e.ANTHROPIC_API_KEY) return (model = null);
  return (model = new AnthropicAgentModel(e.ANTHROPIC_API_KEY, e.AGENT_MODEL));
}

export function setAgentModelForTests(m: AgentModel | null | undefined) {
  model = m;
}
