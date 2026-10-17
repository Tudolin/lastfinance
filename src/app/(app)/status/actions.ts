'use server';

import { requireUnlocked } from '@/server/auth/request';
import { dispatchReason } from '@/server/jobs/dispatch';
import { probeEventApi, type ProbeResult } from '@/server/jobs/inngest-diag';
import { log } from '@/server/log';
import { registerWebhook, type WebhookStatus } from '@/server/services/pluggy-webhook';

export type PingResult =
  | { ok: true; id: string | null; probes: ProbeResult[] }
  | { ok: false; error: string; probes: ProbeResult[] };

/** Envia um evento de teste ao Inngest e devolve o resultado traduzido (sem a mensagem original). */
export async function pingInngestAction(): Promise<PingResult> {
  await requireUnlocked();
  const { inngest } = await import('@/server/jobs/inngest');
  const probes = await probeEventApi();
  for (const p of probes) {
    log.info('diag inngest', {
      job: p.envHeader ? `com x-inngest-env=${p.envHeader}` : 'sem x-inngest-env',
      status: p.status,
      code: p.error,
    });
  }
  try {
    const r = await inngest.send({ name: 'app/diag.ping', data: {} });
    return { ok: true, id: r.ids[0] ?? null, probes };
  } catch (err) {
    const reason = dispatchReason(err);
    return { ok: false, error: `${reason.text} [${reason.code}]`, probes };
  }
}

export type WebhookResult = { ok: true; status: WebhookStatus } | { ok: false; error: string };

/** Registra o webhook global da Pluggy apontando para este deploy. */
export async function registerPluggyWebhookAction(): Promise<WebhookResult> {
  await requireUnlocked();
  try {
    const status = await registerWebhook();
    log.info('pluggy webhook registrado');
    return { ok: true, status };
  } catch (err) {
    log.error('pluggy webhook falhou', err);
    const msg = err instanceof Error ? err.message : '';
    return {
      ok: false,
      error: msg.includes('PLUGGY_WEBHOOK_SECRET')
        ? 'Defina PLUGGY_WEBHOOK_SECRET na Vercel e faça um novo deploy.'
        : 'A Pluggy recusou o registro. Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.',
    };
  }
}
