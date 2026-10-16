import 'server-only';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  addDays,
  addMonths,
  endOfMonth,
  startOfMonth,
  todaySP,
  type LocalDate,
} from '@/domain/dates/local-date';
import { canSpend, type PurchaseInput } from '@/domain/forecast/can-spend';
import { freePerDay, project, type Projection } from '@/domain/forecast/project';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { buildProjectionContext } from '@/server/services/planning';

const { transaction: tx, forecastEntry, forecastMatch } = schema;

export type ChartPoint = {
  date: string;
  actual: number | null;
  base: number | null;
  low: number | null;
  high: number | null;
  conservative: number | null;
  optimistic: number | null;
};

/** Saldo diário das contas de caixa nos últimos `days` dias, reconstruído para trás a partir do atual. */
async function pastBalances(accountIds: string[], current: number, today: LocalDate, days: number) {
  if (accountIds.length === 0) return [] as { date: LocalDate; balance: number }[];
  const from = addDays(today, -days);
  const rows = await getDb()
    .select({ date: tx.date, cents: sql<number>`sum(${tx.amountCents})::bigint` })
    .from(tx)
    .where(and(inArray(tx.accountId, accountIds), isNull(tx.deletedAt), gte(tx.date, from)))
    .groupBy(tx.date);
  const byDate = new Map(rows.map((r) => [r.date, Number(r.cents)]));
  const out: { date: LocalDate; balance: number }[] = [];
  let bal = current;
  // saldo no fim do dia d = saldo atual − movimentos depois de d
  for (let i = 0; i <= days; i++) {
    const d = addDays(today, -i);
    out.push({ date: d, balance: bal });
    bal -= byDate.get(d) ?? 0;
  }
  return out.reverse();
}

function chartSeries(
  past: { date: LocalDate; balance: number }[],
  base: Projection,
  cons: Projection,
  opt: Projection,
): ChartPoint[] {
  const pts: ChartPoint[] = past.slice(0, -1).map((p) => ({
    date: p.date,
    actual: p.balance,
    base: null,
    low: null,
    high: null,
    conservative: null,
    optimistic: null,
  }));
  base.days.forEach((d, i) =>
    pts.push({
      date: d.date,
      actual: i === 0 ? d.balance : null,
      base: d.balance,
      low: d.low,
      high: d.high,
      conservative: cons.days[i]?.balance ?? null,
      optimistic: opt.days[i]?.balance ?? null,
    }),
  );
  return pts;
}

export async function getForecastView(days: 30 | 60 | 90 = 90) {
  await requireUnlocked();
  const today = todaySP();
  const ctx = await buildProjectionContext(days, today);
  const base = project(ctx.input);
  const conservative = project({ ...ctx.input, scenario: 'conservative' });
  const optimistic = project({ ...ctx.input, scenario: 'optimistic' });
  const past = await pastBalances(
    ctx.cashAccounts.map((a) => a.id),
    ctx.input.startBalance,
    today,
    30,
  );
  const free = freePerDay(base, ctx.reserveCents, ctx.nextIncome);
  const upcoming = base.days
    .flatMap((d) => d.events.map((e) => ({ ...e, day: d.date })))
    .filter((e) => e.cents !== 0)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.cents - b.cents));
  return {
    today,
    days,
    startBalance: ctx.input.startBalance,
    cashAccounts: ctx.cashAccounts,
    reserveCents: ctx.reserveCents,
    variableMonthlyCents: ctx.variableMonthlyCents,
    variableSource: ctx.variableSource,
    nextIncome: ctx.nextIncome,
    free,
    base: {
      min: base.min,
      minLow: base.minLow,
      end: base.end,
      negativeDays: base.negativeDays,
      firstNegative: base.firstNegative,
    },
    conservative: {
      min: conservative.min,
      end: conservative.end,
      negativeDays: conservative.negativeDays,
    },
    optimistic: { min: optimistic.min, end: optimistic.end },
    chart: chartSeries(past, base, conservative, optimistic),
    upcoming,
    daily: base.days.map((d) => ({
      date: d.date,
      balance: d.balance,
      inflow: d.inflow,
      outflow: d.outflow,
    })),
  };
}

/** Tabela mensal Previsto × Realizado × Δ (3 meses para trás, o atual e 2 à frente). */
export async function getMonthlyPlanVsActual() {
  await requireUnlocked();
  const db = getDb();
  const today = todaySP();
  const first = addMonths(startOfMonth(today), -3);
  const last = endOfMonth(addMonths(startOfMonth(today), 2));
  const [planned, incomeActual, expenseActual] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${forecastEntry.expectedDate}, 'YYYY-MM')`,
        direction: forecastEntry.direction,
        sourceType: forecastEntry.sourceType,
        expected: sql<number>`sum(coalesce(${forecastEntry.userOverrideCents}, ${forecastEntry.expectedCents}))::bigint`,
        realized: sql<number>`coalesce(sum(${forecastMatch.actualCents}), 0)::bigint`,
        late: sql<number>`count(*) filter (where ${forecastEntry.status} = 'atrasado')::int`,
      })
      .from(forecastEntry)
      .leftJoin(
        forecastMatch,
        and(eq(forecastMatch.forecastEntryId, forecastEntry.id), isNull(forecastMatch.unmatchedAt)),
      )
      .where(
        and(
          gte(forecastEntry.expectedDate, first),
          lte(forecastEntry.expectedDate, last),
          sql`${forecastEntry.status} <> 'cancelado'`,
        ),
      )
      .groupBy(sql`1`, forecastEntry.direction, forecastEntry.sourceType),
    db
      .select({
        month: sql<string>`to_char(${tx.cashDate}, 'YYYY-MM')`,
        cents: sql<number>`sum(${tx.amountCents})::bigint`,
      })
      .from(tx)
      .where(
        and(
          isNull(tx.deletedAt),
          eq(tx.kind, 'income'),
          gte(tx.cashDate, first),
          lte(tx.cashDate, today),
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        month: sql<string>`to_char(${tx.competenceDate}, 'YYYY-MM')`,
        cents: sql<number>`-sum(${tx.amountCents})::bigint`,
      })
      .from(tx)
      .where(
        and(
          isNull(tx.deletedAt),
          inArray(tx.kind, ['expense', 'refund']),
          gte(tx.competenceDate, first),
          lte(tx.competenceDate, today),
        ),
      )
      .groupBy(sql`1`),
  ]);
  const months: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) months.push(m.slice(0, 7));
  const current = today.slice(0, 7);
  return months.map((month) => {
    const rows = planned.filter((p) => p.month === month);
    const inPlanned = rows
      .filter((r) => r.direction === 'in')
      .reduce((s, r) => s + Number(r.expected), 0);
    const outPlanned = rows
      .filter((r) => r.direction === 'out')
      .reduce((s, r) => s + Number(r.expected), 0);
    const outMatched = rows
      .filter((r) => r.direction === 'out' && r.sourceType !== 'installment')
      .reduce((s, r) => s + Number(r.realized), 0);
    const income = Number(incomeActual.find((r) => r.month === month)?.cents ?? 0);
    const expenses = Number(expenseActual.find((r) => r.month === month)?.cents ?? 0);
    return {
      month,
      isFuture: month > current,
      isCurrent: month === current,
      income: { planned: inPlanned, actual: month > current ? null : income },
      plannedExpenses: { planned: outPlanned, matched: month > current ? null : outMatched },
      totalExpenses: month > current ? null : expenses,
      late: rows.reduce((s, r) => s + r.late, 0),
    };
  });
}

/** Previstos recentes e próximos para conciliar (casar/descasar). */
export async function getReconciliation() {
  await requireUnlocked();
  const db = getDb();
  const today = todaySP();
  const entries = await db
    .select({
      e: forecastEntry,
      matchId: forecastMatch.id,
      matchedBy: forecastMatch.matchedBy,
      actualCents: forecastMatch.actualCents,
      deltaCents: forecastMatch.deltaCents,
      txId: tx.id,
      txDate: tx.date,
      txDescription: tx.srcDescription,
    })
    .from(forecastEntry)
    .leftJoin(
      forecastMatch,
      and(eq(forecastMatch.forecastEntryId, forecastEntry.id), isNull(forecastMatch.unmatchedAt)),
    )
    .leftJoin(tx, eq(forecastMatch.transactionId, tx.id))
    .where(
      and(
        sql`${forecastEntry.sourceType} <> 'installment'`,
        gte(forecastEntry.expectedDate, addDays(today, -45)),
        lte(forecastEntry.windowStart, today),
      ),
    )
    .orderBy(desc(forecastEntry.expectedDate))
    .limit(80);
  return entries;
}

/** Transações candidatas para casar à mão com um previsto (mesmo sentido, perto da data). */
export async function getMatchCandidates(entryId: string) {
  await requireUnlocked();
  const db = getDb();
  const [e] = await db.select().from(forecastEntry).where(eq(forecastEntry.id, entryId));
  if (!e) return { entry: null, candidates: [] };
  const rows = await db
    .select({
      id: tx.id,
      date: tx.date,
      description: tx.srcDescription,
      amountCents: tx.amountCents,
      kind: tx.kind,
    })
    .from(tx)
    .where(
      and(
        isNull(tx.deletedAt),
        gte(tx.date, addDays(e.expectedDate as LocalDate, -20)),
        lte(tx.date, addDays(e.expectedDate as LocalDate, 20)),
        e.direction === 'in' ? sql`${tx.amountCents} > 0` : sql`${tx.amountCents} < 0`,
        sql`not exists (select 1 from ${forecastMatch} m where m.transaction_id = "transaction"."id" and m.unmatched_at is null)`,
      ),
    )
    .orderBy(sql`abs(abs(${tx.amountCents}) - ${e.expectedCents})`)
    .limit(15);
  return { entry: e, candidates: rows };
}

export async function simulatePurchase(
  p: Omit<PurchaseInput, 'account'> & { accountId: string | null },
) {
  await requireUnlocked();
  const ctx = await buildProjectionContext(90);
  const account = p.accountId ? (ctx.accounts.get(p.accountId) ?? null) : null;
  const r = canSpend(ctx.input, { ...p, account }, ctx.reserveCents);
  const sample = (proj: Projection) => proj.days.map((d) => ({ date: d.date, balance: d.balance }));
  return {
    verdict: r.verdict,
    reasons: r.reasons,
    reserveCents: ctx.reserveCents,
    before: { min: r.before.min, end: r.before.end },
    after: { min: r.after.min, end: r.after.end, firstNegative: r.after.firstNegative },
    conservativeMin: r.afterConservative.min,
    purchaseEvents: r.purchaseEvents.map((e) => ({ date: e.date, cents: e.cents, label: e.label })),
    series: { before: sample(r.before), after: sample(r.after) },
  };
}
