import 'server-only';
import { env } from '@/lib/env';
import { log } from '@/server/log';
import type { JobEvent } from './events';

type Reason = { code: string; status?: number; text: string; fix: string };

const FIX_KEY =
  'Confira na Vercel se a INNGEST_EVENT_KEY de Production é a do ambiente Production do Inngest e faça Redeploy.';
const FIX_GENERIC =
  'Confira se a integração do Inngest está conectada ao projeto na Vercel (Integrations → Inngest) e faça Redeploy.';

/**
 * Traduz o erro do SDK do Inngest num motivo seguro para mostrar e registrar. Só usa o status HTTP e
 * frases fixas do SDK; a mensagem original nunca sai daqui (pode conter dados de terceiros).
 */
export function dispatchReason(err: unknown): Reason {
  const msg = err instanceof Error ? err.message : '';
  if (/couldn't find an event key/i.test(msg))
    return {
      code: 'event_key_missing',
      text: 'este deploy está sem INNGEST_EVENT_KEY',
      fix: FIX_KEY,
    };
  const http = /Inngest API Error: (\d{3})/.exec(msg);
  if (http) {
    const status = Number(http[1]);
    if (status === 401 || status === 404)
      return {
        code: 'event_key_rejected',
        status,
        text: `o Inngest não reconheceu a chave de eventos (HTTP ${status})`,
        fix: FIX_KEY,
      };
    if (status === 429)
      return {
        code: 'rate_limited',
        status,
        text: 'o Inngest limitou o envio de eventos (HTTP 429)',
        fix: 'Espere alguns minutos e tente de novo; se repetir, veja o uso do plano no painel do Inngest.',
      };
    return {
      code: 'api_error',
      status,
      text: `o Inngest respondeu HTTP ${status}`,
      fix: FIX_GENERIC,
    };
  }
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|network/i.test(msg))
    return {
      code: 'network',
      text: 'sem conexão com o Inngest',
      fix: 'Tente de novo em alguns minutos.',
    };
  return { code: 'unknown', text: 'erro desconhecido ao falar com o Inngest', fix: FIX_GENERIC };
}

/** A fila recusou o job (ex.: Inngest não conectado na Vercel, chave errada). */
export class DispatchError extends Error {
  readonly reason: Reason;
  constructor(cause: unknown) {
    super('Não foi possível enfileirar o job (Inngest).', { cause });
    this.name = 'DispatchError';
    this.reason = dispatchReason(cause);
  }

  /** Mensagem para a tela: o motivo e o que fazer. */
  get help(): string {
    return `Não consegui enfileirar a sincronização: ${this.reason.text}. ${this.reason.fix}`;
  }
}

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
    const e = new DispatchError(err);
    log.error('fila indisponível', err, {
      event: event.name,
      code: e.reason.code,
      status: e.reason.status,
    });
    throw e;
  }
}
