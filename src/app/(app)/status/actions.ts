'use server';

import { requireUnlocked } from '@/server/auth/request';
import { dispatchReason } from '@/server/jobs/dispatch';
import { probeEventApi, type ProbeResult } from '@/server/jobs/inngest-diag';
import { log } from '@/server/log';

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
