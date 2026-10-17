'use server';

import { requireUnlocked } from '@/server/auth/request';
import { dispatchReason } from '@/server/jobs/dispatch';

export type PingResult = { ok: true; id: string | null } | { ok: false; error: string };

/** Envia um evento de teste ao Inngest e devolve o resultado traduzido (sem a mensagem original). */
export async function pingInngestAction(): Promise<PingResult> {
  await requireUnlocked();
  const { inngest } = await import('@/server/jobs/inngest');
  try {
    const r = await inngest.send({ name: 'app/diag.ping', data: {} });
    return { ok: true, id: r.ids[0] ?? null };
  } catch (err) {
    const reason = dispatchReason(err);
    return { ok: false, error: `${reason.text} [${reason.code}]` };
  }
}
