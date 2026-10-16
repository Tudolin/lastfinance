'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { addDays, isLocalDate, todaySP, type LocalDate } from '@/domain/dates/local-date';
import { defaultThirteenthDates } from '@/domain/income/generate';
import { paymentRuleSchema, type PaymentRule } from '@/domain/income/payment-rule';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { getMatchCandidates, simulatePurchase } from '@/server/queries/forecast';
import { refreshPlanning } from '@/server/services/planning';

export type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const uuid = z.string().uuid();
const dateStr = z.string().refine((s) => isLocalDate(s), 'Data inválida');
const optDate = z
  .union([z.literal(''), dateStr])
  .optional()
  .transform((v) => (v ? (v as LocalDate) : null));
const optUuid = z
  .union([z.literal(''), uuid])
  .optional()
  .transform((v) => v || null);
const reais = z.coerce.number().min(0).max(100_000_000);
const optReais = z
  .union([z.literal(''), z.coerce.number().min(0).max(100_000_000)])
  .optional()
  .transform((v) => (v === '' || v == null ? null : Math.round(Number(v) * 100)));
const cents = (n: number) => Math.round(n * 100);

const PATHS = [
  '/',
  '/previsao',
  '/previsao/conciliacao',
  '/posso-gastar',
  '/renda',
  '/recorrencias',
  '/planejados',
];
async function refresh() {
  await refreshPlanning(todaySP());
  for (const p of PATHS) revalidatePath(p);
}

function fail(e: z.ZodError): Result {
  return { ok: false, error: e.issues[0]?.message ?? 'Dados inválidos.' };
}

// ───────────────────────── Renda ─────────────────────────

const incomeSchema = z.object({
  id: optUuid,
  name: z.string().trim().min(2, 'Dê um nome (2+ letras).').max(60),
  type: z.enum(['clt', 'pj', 'other']),
  employerName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  matchPattern: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  accountId: optUuid,
  startDate: dateStr,
  endDate: optDate,
  gross: reais.refine((v) => v > 0, 'Informe o valor bruto.'),
  // regra de pagamento
  ruleType: z.enum(['nth_business_day', 'fixed_day', 'last_business_day']),
  ruleN: z.coerce.number().int().min(1).max(31).default(5),
  monthOffset: z.coerce.number().int().min(0).max(1),
  saturday: z.literal('on').optional(),
  advancePct: z.union([z.literal(''), z.coerce.number().min(0).max(90)]).optional(),
  advanceDay: z.union([z.literal(''), z.coerce.number().int().min(1).max(31)]).optional(),
  // CLT
  dependents: z.coerce.number().int().min(0).max(20).default(0),
  alimony: optReais,
  privatePension: optReais,
  transportVoucher: optReais,
  health: optReais,
  meal: optReais,
  otherDeduction: optReais,
  // PJ
  regime: z.enum(['mei', 'simples', 'presumido', 'manual']).optional(),
  simplesAnnex: z.enum(['iii', 'v', 'fator_r']).optional(),
  rbt12: optReais,
  issRate: z.union([z.literal(''), z.coerce.number().min(0).max(5)]).optional(),
  manualRate: z.union([z.literal(''), z.coerce.number().min(0).max(100)]).optional(),
  proLabore: optReais,
  monthlyCosts: optReais,
  forecastMode: z.enum(['calculated', 'calibrated']).default('calculated'),
  prorate: z.literal('on').optional(),
});

function ruleFrom(d: z.infer<typeof incomeSchema>): PaymentRule {
  const main =
    d.ruleType === 'nth_business_day'
      ? { type: 'nth_business_day' as const, n: Math.min(23, d.ruleN) }
      : d.ruleType === 'fixed_day'
        ? { type: 'fixed_day' as const, day: d.ruleN, adjust: 'previous' as const }
        : { type: 'last_business_day' as const };
  const adv =
    typeof d.advancePct === 'number' && d.advancePct > 0 && typeof d.advanceDay === 'number';
  return paymentRuleSchema.parse({
    parts: adv
      ? [
          {
            pct: d.advancePct,
            rule: { type: 'fixed_day', day: d.advanceDay, adjust: 'previous' },
            monthOffset: 0,
          },
          { pct: 100 - (d.advancePct as number), rule: main, monthOffset: d.monthOffset },
        ]
      : [{ pct: 100, rule: main, monthOffset: d.monthOffset }],
    saturdayIsBusinessDay: d.saturday === 'on',
  });
}

export async function saveIncomeSourceAction(
  _: Result | undefined,
  fd: FormData,
): Promise<Result<{ id: string }>> {
  await requireUnlocked();
  const p = incomeSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail(p.error) as Result<{ id: string }>;
  const d = p.data;
  let rule: PaymentRule;
  try {
    rule = ruleFrom(d);
  } catch {
    return { ok: false, error: 'Regra de pagamento inválida.' };
  }
  const others = [
    d.health ? { label: 'Plano de saúde', cents: d.health } : null,
    d.meal ? { label: 'Vale-refeição/alimentação', cents: d.meal } : null,
    d.otherDeduction ? { label: 'Outros descontos', cents: d.otherDeduction } : null,
  ].filter((x): x is { label: string; cents: number } => !!x);
  const values = {
    name: d.name,
    type: d.type,
    employerName: d.employerName,
    matchPattern: d.matchPattern ?? d.employerName,
    accountId: d.accountId,
    startDate: d.startDate,
    endDate: d.endDate,
    status: d.endDate && d.endDate < todaySP() ? ('ended' as const) : ('active' as const),
    paymentRule: rule,
    deductions:
      d.type === 'clt'
        ? {
            dependents: d.dependents,
            alimony: d.alimony ?? undefined,
            privatePension: d.privatePension ?? undefined,
            transportVoucher: d.transportVoucher,
            others,
          }
        : {},
    pjConfig:
      d.type === 'pj'
        ? {
            regime: d.regime ?? 'simples',
            simplesAnnex: d.simplesAnnex ?? 'fator_r',
            rbt12: d.rbt12,
            issRate: typeof d.issRate === 'number' ? d.issRate / 100 : undefined,
            manualRate: typeof d.manualRate === 'number' ? d.manualRate / 100 : undefined,
            proLabore: d.proLabore ?? undefined,
            monthlyCosts: d.monthlyCosts ?? undefined,
            dependents: d.dependents,
          }
        : null,
    forecastMode: d.forecastMode,
    prorateFirstMonth: d.prorate === 'on',
  };
  const db = getDb();
  let id = d.id;
  if (id) {
    await db.update(schema.incomeSource).set(values).where(eq(schema.incomeSource.id, id));
    // O valor do formulário vale a partir da vigência mais recente.
    const [last] = await db
      .select()
      .from(schema.incomeSalaryHistory)
      .where(
        and(
          eq(schema.incomeSalaryHistory.incomeSourceId, id),
          isNull(schema.incomeSalaryHistory.validTo),
        ),
      );
    if (last && last.grossCents !== cents(d.gross))
      await db
        .update(schema.incomeSalaryHistory)
        .set({ grossCents: cents(d.gross) })
        .where(eq(schema.incomeSalaryHistory.id, last.id));
  } else {
    const [row] = await db
      .insert(schema.incomeSource)
      .values(values)
      .returning({ id: schema.incomeSource.id });
    id = row!.id;
    await db
      .insert(schema.incomeSalaryHistory)
      .values({ incomeSourceId: id, grossCents: cents(d.gross), validFrom: d.startDate });
  }
  await refresh();
  return { ok: true, data: { id } };
}

/** Reajuste: fecha a vigência atual na véspera e abre a nova. */
export async function addSalaryChangeAction(
  sourceId: string,
  gross: number,
  validFrom: string,
): Promise<Result> {
  await requireUnlocked();
  const p = z
    .object({ sourceId: uuid, gross: reais.refine((v) => v > 0), validFrom: dateStr })
    .safeParse({ sourceId, gross, validFrom });
  if (!p.success) return fail(p.error);
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.incomeSalaryHistory)
    .where(eq(schema.incomeSalaryHistory.incomeSourceId, p.data.sourceId));
  if (rows.some((r) => r.validFrom >= p.data.validFrom))
    return { ok: false, error: 'Já existe um valor com vigência nesta data ou depois.' };
  const open = rows.find((r) => !r.validTo);
  if (open)
    await db
      .update(schema.incomeSalaryHistory)
      .set({ validTo: addDays(p.data.validFrom as LocalDate, -1) })
      .where(eq(schema.incomeSalaryHistory.id, open.id));
  await db.insert(schema.incomeSalaryHistory).values({
    incomeSourceId: p.data.sourceId,
    grossCents: cents(p.data.gross),
    validFrom: p.data.validFrom,
  });
  await refresh();
  return { ok: true };
}

export async function deleteIncomeSourceAction(id: string): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .delete(schema.incomeSource)
    .where(eq(schema.incomeSource.id, uuid.parse(id)));
  await getDb().delete(schema.forecastEntry).where(eq(schema.forecastEntry.sourceId, id));
  await refresh();
  return { ok: true };
}

const eventSchema = z.object({
  sourceId: uuid,
  type: z.enum(['13_1', '13_2', 'vacation', 'plr', 'bonus', 'other']),
  expectedDate: dateStr,
  gross: optReais,
  net: optReais,
  vacationDays: z.union([z.literal(''), z.coerce.number().int().min(5).max(30)]).optional(),
});

export async function addIncomeEventAction(_: Result | undefined, fd: FormData): Promise<Result> {
  await requireUnlocked();
  const p = eventSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail(p.error);
  await getDb()
    .insert(schema.incomeEvent)
    .values({
      incomeSourceId: p.data.sourceId,
      type: p.data.type,
      expectedDate: p.data.expectedDate,
      grossCents: p.data.gross,
      netCents: p.data.net,
      vacationDays: typeof p.data.vacationDays === 'number' ? p.data.vacationDays : null,
    });
  await refresh();
  return { ok: true };
}

/** Atalho: as duas parcelas do 13º nas datas legais do ano. */
export async function addThirteenthAction(sourceId: string, year: number): Promise<Result> {
  await requireUnlocked();
  const { first, second } = defaultThirteenthDates(
    z.number().int().min(2020).max(2100).parse(year),
  );
  await getDb()
    .insert(schema.incomeEvent)
    .values([
      { incomeSourceId: uuid.parse(sourceId), type: '13_1', expectedDate: first },
      { incomeSourceId: sourceId, type: '13_2', expectedDate: second },
    ]);
  await refresh();
  return { ok: true };
}

export async function deleteIncomeEventAction(id: string): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .delete(schema.incomeEvent)
    .where(eq(schema.incomeEvent.id, uuid.parse(id)));
  await getDb().delete(schema.forecastEntry).where(eq(schema.forecastEntry.sourceId, id));
  await refresh();
  return { ok: true };
}

// ───────────────────────── Recorrências ─────────────────────────

const recurringSchema = z.object({
  id: optUuid,
  name: z.string().trim().min(2, 'Dê um nome.').max(60),
  direction: z.enum(['in', 'out']),
  amount: reais.refine((v) => v > 0, 'Informe o valor.'),
  anchorDay: z.coerce.number().int().min(0).max(31),
  periodicity: z.enum(['weekly', 'monthly', 'yearly']),
  anchorMonth: z.union([z.literal(''), z.coerce.number().int().min(1).max(12)]).optional(),
  nature: z.enum(['fixed', 'variable']),
  accountId: optUuid,
  categoryId: optUuid,
  matchPattern: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  endDate: optDate,
});

export async function saveRecurringAction(_: Result | undefined, fd: FormData): Promise<Result> {
  await requireUnlocked();
  const p = recurringSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail(p.error);
  const d = p.data;
  if (d.periodicity !== 'weekly' && d.anchorDay < 1) return { ok: false, error: 'Dia inválido.' };
  const values = {
    name: d.name,
    direction: d.direction,
    amountCents: cents(d.amount),
    anchorDay: d.anchorDay,
    periodicity: d.periodicity,
    anchorMonth:
      d.periodicity === 'yearly' && typeof d.anchorMonth === 'number' ? d.anchorMonth : null,
    nature: d.nature,
    tolerancePct: d.nature === 'fixed' ? 0.05 : 0.2,
    accountId: d.accountId,
    categoryId: d.categoryId,
    matchPattern: d.matchPattern,
    endDate: d.endDate,
    status: 'confirmed' as const,
  };
  const db = getDb();
  if (d.id)
    await db.update(schema.recurringItem).set(values).where(eq(schema.recurringItem.id, d.id));
  else await db.insert(schema.recurringItem).values({ ...values, startDate: todaySP() });
  await refresh();
  return { ok: true };
}

export async function setRecurringStatusAction(
  id: string,
  status: 'confirmed' | 'ignored' | 'suggested',
): Promise<Result> {
  await requireUnlocked();
  const s = z.enum(['confirmed', 'ignored', 'suggested']).parse(status);
  await getDb()
    .update(schema.recurringItem)
    .set({ status: s })
    .where(eq(schema.recurringItem.id, uuid.parse(id)));
  await refresh();
  return { ok: true };
}

export async function deleteRecurringAction(id: string): Promise<Result> {
  await requireUnlocked();
  const db = getDb();
  const [r] = await db
    .select()
    .from(schema.recurringItem)
    .where(eq(schema.recurringItem.id, uuid.parse(id)));
  // Itens detectados viram "ignorados" (senão a detecção os sugere de novo); manuais são apagados.
  if (r?.descriptionNorm)
    await db
      .update(schema.recurringItem)
      .set({ status: 'ignored' })
      .where(eq(schema.recurringItem.id, id));
  else await db.delete(schema.recurringItem).where(eq(schema.recurringItem.id, id));
  await refresh();
  return { ok: true };
}

// ───────────────────────── Gastos planejados ─────────────────────────

const plannedSchema = z.object({
  description: z.string().trim().min(2, 'Descreva o gasto.').max(80),
  amount: reais.refine((v) => v > 0, 'Informe o valor.'),
  date: dateStr,
  paymentMethod: z.enum(['pix', 'debit', 'credit']),
  installments: z.coerce.number().int().min(1).max(48).default(1),
  accountId: optUuid,
  categoryId: optUuid,
});

export async function createPlannedAction(_: Result | undefined, fd: FormData): Promise<Result> {
  await requireUnlocked();
  const p = plannedSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail(p.error);
  const d = p.data;
  await getDb()
    .insert(schema.plannedExpense)
    .values({
      description: d.description,
      amountCents: cents(d.amount),
      date: d.date,
      paymentMethod: d.paymentMethod,
      installments: d.paymentMethod === 'credit' ? d.installments : 1,
      accountId: d.accountId,
      categoryId: d.categoryId,
    });
  await refresh();
  return { ok: true };
}

export async function setPlannedStatusAction(
  id: string,
  status: 'planned' | 'done' | 'cancelled',
): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .update(schema.plannedExpense)
    .set({ status: z.enum(['planned', 'done', 'cancelled']).parse(status) })
    .where(eq(schema.plannedExpense.id, uuid.parse(id)));
  await refresh();
  return { ok: true };
}

export async function deletePlannedAction(id: string): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .delete(schema.plannedExpense)
    .where(eq(schema.plannedExpense.id, uuid.parse(id)));
  await refresh();
  return { ok: true };
}

// ───────────────────────── Conciliação ─────────────────────────

export async function unmatchAction(matchId: string): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .update(schema.forecastMatch)
    .set({ unmatchedAt: new Date() })
    .where(eq(schema.forecastMatch.id, uuid.parse(matchId)));
  await refresh();
  return { ok: true };
}

export async function manualMatchAction(entryId: string, txId: string): Promise<Result> {
  await requireUnlocked();
  const db = getDb();
  const [e] = await db
    .select()
    .from(schema.forecastEntry)
    .where(eq(schema.forecastEntry.id, uuid.parse(entryId)));
  const [t] = await db
    .select()
    .from(schema.transaction)
    .where(eq(schema.transaction.id, uuid.parse(txId)));
  if (!e || !t) return { ok: false, error: 'Não encontrado.' };
  const busy = await db
    .select({ id: schema.forecastMatch.id })
    .from(schema.forecastMatch)
    .where(
      and(isNull(schema.forecastMatch.unmatchedAt), eq(schema.forecastMatch.transactionId, t.id)),
    );
  if (busy.length) return { ok: false, error: 'Esta transação já está casada com outro previsto.' };
  // Um previsto tem no máximo um par ativo: o anterior (se houver) é desfeito.
  await db
    .update(schema.forecastMatch)
    .set({ unmatchedAt: new Date() })
    .where(
      and(eq(schema.forecastMatch.forecastEntryId, e.id), isNull(schema.forecastMatch.unmatchedAt)),
    );
  const expected = e.userOverrideCents ?? e.expectedCents;
  await db.insert(schema.forecastMatch).values({
    forecastEntryId: e.id,
    transactionId: t.id,
    matchedBy: 'user',
    expectedCents: expected,
    actualCents: Math.abs(t.amountCents),
    deltaCents: Math.abs(t.amountCents) - expected,
  });
  await refresh();
  return { ok: true };
}

export async function setEntryStatusAction(
  entryId: string,
  status: 'cancelado' | 'previsto',
): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .update(schema.forecastEntry)
    .set({ status: z.enum(['cancelado', 'previsto']).parse(status) })
    .where(eq(schema.forecastEntry.id, uuid.parse(entryId)));
  await refresh();
  return { ok: true };
}

export async function overrideEntryAction(entryId: string, amount: number | null): Promise<Result> {
  await requireUnlocked();
  const v = amount == null ? null : cents(reais.parse(amount));
  await getDb()
    .update(schema.forecastEntry)
    .set({ userOverrideCents: v, status: v == null ? 'previsto' : 'ajustado' })
    .where(eq(schema.forecastEntry.id, uuid.parse(entryId)));
  await refresh();
  return { ok: true };
}

export async function matchCandidatesAction(entryId: string) {
  const r = await getMatchCandidates(uuid.parse(entryId));
  return r.candidates;
}

export async function refreshPlanningAction(): Promise<Result> {
  await requireUnlocked();
  await refresh();
  return { ok: true };
}

// ───────────────────────── Posso gastar? ─────────────────────────

const simulateSchema = z.object({
  amount: reais.refine((v) => v > 0, 'Informe o valor.'),
  method: z.enum(['pix', 'debit', 'credit']),
  installments: z.coerce.number().int().min(1).max(48).default(1),
  date: dateStr.optional(),
  accountId: optUuid,
  description: z.string().trim().max(80).optional(),
});

export async function simulateAction(
  _: unknown,
  fd: FormData,
): Promise<
  { ok: true; data: Awaited<ReturnType<typeof simulatePurchase>> } | { ok: false; error: string }
> {
  await requireUnlocked();
  const p = simulateSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Dados inválidos.' };
  const d = p.data;
  const data = await simulatePurchase({
    amountCents: cents(d.amount),
    method: d.method,
    installments: d.method === 'credit' ? d.installments : 1,
    date: (d.date as LocalDate | undefined) ?? todaySP(),
    accountId: d.accountId,
    description: d.description || undefined,
  });
  return { ok: true, data };
}

/** Transforma a simulação em gasto planejado (entra na previsão). */
export async function planFromSimulationAction(
  _: Result | undefined,
  fd: FormData,
): Promise<Result> {
  return createPlannedAction(undefined, fd);
}
