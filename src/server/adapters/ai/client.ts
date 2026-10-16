import 'server-only';
import { env } from '@/lib/env';
import type { AiGateway } from './types';

let gateway: AiGateway | null | undefined;

/** IA disponível? Sem chave (e fora do modo fake), a categorização usa só regras e cache. */
export async function getAi(): Promise<AiGateway | null> {
  if (gateway !== undefined) return gateway;
  const e = env();
  if (e.AI_FAKE) {
    const { FakeAiGateway } = await import('./fake');
    return (gateway = new FakeAiGateway());
  }
  if (!e.ANTHROPIC_API_KEY) return (gateway = null);
  const { AnthropicAiGateway } = await import('./anthropic');
  return (gateway = new AnthropicAiGateway(e.ANTHROPIC_API_KEY, e.AI_MODEL));
}

export function setAiForTests(g: AiGateway | null | undefined) {
  gateway = g;
}
