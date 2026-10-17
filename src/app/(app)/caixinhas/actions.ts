'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isLocalDate } from '@/domain/dates/local-date';
import { parseSettings } from '@/server/auth/settings';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';

export type Result = { ok: true } | { ok: false; error: string };

const uuid = z.string().uuid();
const optUuid = z
  .union([z.literal(''), uuid])
  .optional()
  .transform((v) => v || null);
const optDate = z
  .union([z.literal(''), z.string().refine((s) => isLocalDate(s), 'Data inválida')])
  .optional()
  .transform((v) => v || null);
const reais = z.coerce.number().min(0, 'Valor inválido.').max(100_000_000, 'Valor alto demais.');
const toCents = (n: number) => Math.round(n * 100);

function refresh() {
  for (const p of ['/caixinhas', '/patrimonio', '/']) revalidatePath(p);
}

const goalSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome (2+ letras).').max(60),
  target: reais.refine((n) => n > 0, 'Informe o valor da meta.'),
  targetDate: optDate,
  investmentId: optUuid,
  saved: z.union([z.literal(''), reais]).optional(),
});

export async function createGoalAction(_: Result | undefined, fd: FormData): Promise<Result> {
  await requireUnlocked();
  const p = goalSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Dados inválidos.' };
  const d = p.data;
  await getDb()
    .insert(schema.goal)
    .values({
      name: d.name,
      targetCents: toCents(d.target),
      targetDate: d.targetDate,
      investmentId: d.investmentId,
      manualSavedCents: d.investmentId || !d.saved ? 0 : toCents(Number(d.saved)),
    });
  refresh();
  return { ok: true };
}

/** Atualiza o valor guardado à mão (metas sem investimento vinculado). */
export async function setGoalSavedAction(id: string, saved: number): Promise<Result> {
  await requireUnlocked();
  const v = reais.safeParse(saved);
  if (!v.success) return { ok: false, error: 'Valor inválido.' };
  await getDb()
    .update(schema.goal)
    .set({ manualSavedCents: toCents(v.data), updatedAt: new Date() })
    .where(eq(schema.goal.id, uuid.parse(id)));
  refresh();
  return { ok: true };
}

export async function setGoalStatusAction(
  id: string,
  status: 'active' | 'done' | 'archived',
): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .update(schema.goal)
    .set({ status: z.enum(['active', 'done', 'archived']).parse(status), updatedAt: new Date() })
    .where(eq(schema.goal.id, uuid.parse(id)));
  refresh();
  return { ok: true };
}

export async function deleteGoalAction(id: string): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .delete(schema.goal)
    .where(eq(schema.goal.id, uuid.parse(id)));
  refresh();
  return { ok: true };
}

/** Quantos meses de gastos essenciais a reserva de emergência deve cobrir. */
export async function setEmergencyMonthsAction(months: number): Promise<Result> {
  const s = await requireUnlocked();
  const v = z.number().int().min(1).max(24).safeParse(months);
  if (!v.success) return { ok: false, error: 'Escolha entre 1 e 24 meses.' };
  const db = getDb();
  const [user] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, s.user.id));
  await db
    .update(schema.appUser)
    .set({ settings: { ...parseSettings(user?.settings), emergencyMonths: v.data } })
    .where(eq(schema.appUser.id, s.user.id));
  refresh();
  return { ok: true };
}
