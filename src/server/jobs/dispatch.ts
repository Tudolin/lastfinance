import 'server-only';
import { env } from '@/lib/env';
import { log } from '@/server/log';
import type { JobEvent } from './events';

/** A fila recusou o job (ex.: Inngest não conectado na Vercel). */
export class DispatchError extends Error {
  constructor(cause: unknown) {
    super('Não foi possível enfileirar o job (Inngest).', { cause });
    this.name = 'DispatchError';
  }
}

export const DISPATCH_HELP =
  'Não consegui enfileirar a sincronização: confira se a integração do Inngest está conectada ao projeto na Vercel (Integrations → Inngest) e faça Redeploy.';

/**
 * Envia um job para a fila. Em produção vai para o Inngest; com JOBS_MODE=inline (dev sem Inngest,
 * testes de integração e E2E) executa na hora com passos não duráveis.
 */
export async function dispatch(event: JobEvent): Promise<void> {
  if (env().JOBS_MODE === 'inline') {
    const { runInline } = await import('./handlers');
    await runInline(event);
    return;
  }
  const { inngest } = await import('./inngest');
  try {
    await inngest.send(event);
  } catch (err) {
    log.error('fila indisponível', err, { event: event.name });
    throw new DispatchError(err);
  }
}
