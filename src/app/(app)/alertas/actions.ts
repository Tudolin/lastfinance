'use server';

import { eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { clientInfo, requireUnlocked } from '@/server/auth/request';
import { parseSettings } from '@/server/auth/settings';
import { getDb, schema } from '@/server/db/client';
import { ALERT_TYPES, evaluateAlerts } from '@/server/services/alerts';
import { getPushSender } from '@/server/adapters/push/sender';

export type Result = { ok: true; message?: string } | { ok: false; error: string };

const subSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Guarda a inscrição de push deste navegador. */
export async function subscribePushAction(raw: unknown): Promise<Result> {
  await requireUnlocked();
  const p = subSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: 'Inscrição inválida.' };
  const { endpoint, keys } = p.data;
  const ua = (await clientInfo()).userAgent?.slice(0, 200) ?? null;
  await getDb()
    .insert(schema.pushSubscription)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua })
    .onConflictDoUpdate({
      target: schema.pushSubscription.endpoint,
      set: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: ua,
        failures: 0,
        updatedAt: new Date(),
      },
    });
  revalidatePath('/alertas');
  return { ok: true };
}

export async function unsubscribePushAction(endpoint: string): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .delete(schema.pushSubscription)
    .where(eq(schema.pushSubscription.endpoint, z.string().url().parse(endpoint)));
  revalidatePath('/alertas');
  return { ok: true };
}

/** Manda uma notificação de teste para todos os aparelhos inscritos. */
export async function testPushAction(): Promise<Result> {
  await requireUnlocked();
  const sender = getPushSender();
  if (!sender.enabled) return { ok: false, error: 'Notificações não configuradas no servidor.' };
  const subs = await getDb().select().from(schema.pushSubscription);
  if (!subs.length) return { ok: false, error: 'Nenhum aparelho com notificações ativadas.' };
  let ok = 0;
  for (const s of subs) {
    const r = await sender.send(s, {
      title: 'lastfinance',
      body: 'Notificações funcionando neste aparelho.',
      url: '/alertas',
      tag: 'teste',
    });
    if (r.ok) ok++;
    else if (r.gone)
      await getDb().delete(schema.pushSubscription).where(eq(schema.pushSubscription.id, s.id));
  }
  return ok
    ? { ok: true, message: `Enviada para ${ok} aparelho(s).` }
    : { ok: false, error: 'Não foi possível enviar.' };
}

export async function markAllReadAction(): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .update(schema.alertEvent)
    .set({ readAt: new Date() })
    .where(isNull(schema.alertEvent.readAt));
  revalidatePath('/alertas');
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Verifica agora (sem esperar a próxima hora). */
export async function checkNowAction(): Promise<Result> {
  await requireUnlocked();
  const r = await evaluateAlerts();
  revalidatePath('/alertas');
  return {
    ok: true,
    message: r.created ? `${r.created} alerta(s) novo(s).` : 'Nada novo por enquanto.',
  };
}

const prefsSchema = z.object({
  largeExpense: z.coerce.number().min(0).max(1_000_000),
  quietStart: z.coerce.number().int().min(0).max(23),
  quietEnd: z.coerce.number().int().min(0).max(23),
});

export async function updateAlertPrefsAction(_: Result | undefined, fd: FormData): Promise<Result> {
  const s = await requireUnlocked();
  const p = prefsSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, error: 'Valores inválidos.' };
  const on = new Set(fd.getAll('types').map(String));
  const db = getDb();
  const [user] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, s.user.id));
  await db
    .update(schema.appUser)
    .set({
      settings: {
        ...parseSettings(user?.settings),
        alertLargeExpenseCents: Math.round(p.data.largeExpense * 100),
        quietStartHour: p.data.quietStart,
        quietEndHour: p.data.quietEnd,
        alertsOff: Object.keys(ALERT_TYPES).filter((t) => !on.has(t)),
      },
    })
    .where(eq(schema.appUser.id, s.user.id));
  revalidatePath('/alertas');
  return { ok: true, message: 'Preferências salvas.' };
}
