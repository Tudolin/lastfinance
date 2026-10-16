import 'server-only';
import { env } from '@/lib/env';
import type { JobEvent } from './events';

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
  await inngest.send(event);
}
