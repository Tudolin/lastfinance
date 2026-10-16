import 'server-only';
import { and, between, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { analyzeGroup, monthRange, type GroupStats, type Nature } from '@/domain/analysis/nature';
import { budgetPace, rolloverCents, type BudgetPace } from '@/domain/budgets/pace';
import {
  futureCommitment,
  projectFutureInstallments,
  type FutureInstallment,
} from '@/domain/cards/installments';
import {
  addMonths,
  daysInMonth,
  endOfMonth,
  parts,
  startOfMonth,
  todaySP,
  type LocalDate,
} from '@/domain/dates/local-date';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { categoryLabel, listCategories } from '@/server/services/categories';
import { categoryBreakdown } from './categories';

const {
  transaction: tx,
  budget,
  account,
  creditCardBill,
  institutionConnection,
  merchant,
} = schema;

// ───────────────────────── Orçamentos ─────────────────────────

export type BudgetRow = {
  id: string;
  categoryId: string;
  label: string;
  color: string | null;
  amountCents: number;
  rollover: boolean;
  pace: BudgetPace;
};

/** Gasto por categoria incluindo as subcategorias (orçamento na categoria-mãe soma as filhas). */
async function spentByCategoryTree(from: string, to: string) {
  const [breakdown, cats] = await Promise.all([
    categoryBreakdown(from, to, 'accrual'),
    listCategories(true),
  ]);
  const direct = new Map(
    breakdown.filter((b) => b.categoryId).map((b) => [b.categoryId!, b.cents]),
  );
  const total = new Map<string, number>();
  for (const c of cats) {
    const own = direct.get(c.id) ?? 0;
    total.set(c.id, (total.get(c.id) ?? 0) + own);
    if (c.parentId) total.set(c.parentId, (total.get(c.parentId) ?? 0) + own);
  }
  return total;
}

export async function getBudgets(month: LocalDate) {
  await requireUnlocked();
  const db = getDb();
  const start = startOfMonth(month);
  const prev = addMonths(start, -1);
  const [rows, prevRows, cats, spent, prevSpent] = await Promise.all([
    db.select().from(budget).where(eq(budget.month, start)),
    db.select().from(budget).where(eq(budget.month, prev)),
    listCategories(true),
    spentByCategoryTree(start, endOfMonth(start)),
    spentByCategoryTree(prev, endOfMonth(prev)),
  ]);
  const today = todaySP();
  const { year, month: m } = parts(start);
  const dim = daysInMonth(year, m);
  const day = today < start ? 1 : today > endOfMonth(start) ? dim : parts(today).day;

  const out: BudgetRow[] = [];
  for (const b of rows) {
    const p = prevRows.find((x) => x.categoryId === b.categoryId);
    const rolledIn =
      b.rollover && p
        ? rolloverCents({
            amountCents: p.amountCents,
            rolledInCents: p.rolledInCents,
            spentCents: prevSpent.get(p.categoryId) ?? 0,
            rollover: p.rollover,
          })
        : 0;
    if (rolledIn !== b.rolledInCents)
      await db.update(budget).set({ rolledInCents: rolledIn }).where(eq(budget.id, b.id));
    const c = cats.find((x) => x.id === b.categoryId);
    out.push({
      id: b.id,
      categoryId: b.categoryId,
      label: c ? categoryLabel(c, cats) : '—',
      color: c?.color ?? cats.find((x) => x.id === c?.parentId)?.color ?? null,
      amountCents: b.amountCents,
      rollover: b.rollover,
      pace: budgetPace({
        amountCents: b.amountCents,
        rolledInCents: rolledIn,
        spentCents: spent.get(b.categoryId) ?? 0,
        day,
        daysInMonth: dim,
      }),
    });
  }
  return out.sort((a, b) => b.pace.usedRatio - a.pace.usedRatio);
}

// ───────────────────────── Cartões ─────────────────────────

export async function getCardsOverview() {
  await requireUnlocked();
  const db = getDb();
  const today = todaySP();
  const cards = await db
    .select({ a: account, institution: institutionConnection.connectorName })
    .from(account)
    .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
    .where(
      and(
        eq(account.kind, 'credit_card'),
        eq(account.isActive, true),
        isNull(institutionConnection.deletedAt),
      ),
    );
  if (cards.length === 0)
    return {
      cards: [],
      commitment: [],
      futureInstallments: [] as FutureInstallment[],
      monthlyIncomeCents: 0,
    };
  const cardIds = cards.map((c) => c.a.id);

  const [bills, instRows] = await Promise.all([
    db
      .select()
      .from(creditCardBill)
      .where(
        and(
          inArray(creditCardBill.accountId, cardIds),
          gte(creditCardBill.dueDate, addMonths(today, -1)),
        ),
      )
      .orderBy(creditCardBill.dueDate),
    db
      .select({
        accountId: tx.accountId,
        descriptionNorm: tx.descriptionNorm,
        amountCents: tx.amountCents,
        n: tx.installmentNumber,
        total: tx.installmentTotal,
        cashDate: tx.cashDate,
        billDue: creditCardBill.dueDate,
      })
      .from(tx)
      .leftJoin(creditCardBill, eq(tx.billId, creditCardBill.id))
      .where(
        and(
          inArray(tx.accountId, cardIds),
          isNull(tx.deletedAt),
          isNotNull(tx.installmentNumber),
          eq(tx.kind, 'expense'),
        ),
      ),
  ]);
  const dueDays = new Map(cards.filter((c) => c.a.dueDay).map((c) => [c.a.id, c.a.dueDay!]));
  const future = projectFutureInstallments(
    instRows.map((r) => ({
      accountId: r.accountId,
      baseDescription: r.descriptionNorm,
      amountCents: r.amountCents,
      installmentNumber: r.n!,
      installmentTotal: r.total!,
      dueDate: (r.billDue ?? r.cashDate) as LocalDate,
    })),
    dueDays,
  ).filter((f) => f.dueDate > today);

  // renda média dos 3 últimos meses completos (regime de caixa)
  const from = addMonths(startOfMonth(today), -3);
  const [inc] = await db
    .select({ total: sql<number>`coalesce(sum(${tx.amountCents}), 0)::bigint` })
    .from(tx)
    .where(
      and(
        isNull(tx.deletedAt),
        eq(tx.kind, 'income'),
        between(tx.cashDate, from, addMonths(startOfMonth(today), 0)),
      ),
    );
  const monthlyIncomeCents = Math.round(Number(inc?.total ?? 0) / 3);

  return {
    cards: cards.map(({ a, institution }) => {
      const own = bills.filter((b) => b.accountId === a.id);
      const current = own.find((b) => b.dueDate >= today) ?? null;
      const upcomingInstallments = future.filter((f) => f.accountId === a.id);
      return {
        id: a.id,
        name: a.name,
        institution,
        closingDay: a.closingDay,
        dueDay: a.dueDay,
        creditLimitCents: a.creditLimitCents,
        availableLimitCents: a.availableLimitCents,
        currentBill: current,
        recentBills: own.filter((b) => b.dueDate < today).slice(-3),
        upcomingInstallments,
      };
    }),
    commitment: futureCommitment(future, monthlyIncomeCents).slice(0, 12),
    futureInstallments: future,
    monthlyIncomeCents,
  };
}

// ───────────────────────── Fixas × variáveis ─────────────────────────

export type NatureGroup = {
  key: string;
  name: string;
  categoryLabel: string | null;
  stats: GroupStats;
  shareOfIncome: number | null;
};

export async function getNatureAnalysis() {
  await requireUnlocked();
  const db = getDb();
  const today = todaySP();
  const lastFull = addMonths(startOfMonth(today), -1);
  const first = addMonths(lastFull, -11);
  const months = monthRange(first.slice(0, 7), lastFull.slice(0, 7));

  const [rows, merchants, cats] = await Promise.all([
    db
      .select({
        norm: tx.descriptionNorm,
        month: sql<string>`to_char(${tx.competenceDate}, 'YYYY-MM')`,
        cents: sql<number>`-sum(${tx.amountCents})::bigint`,
        count: sql<number>`count(*)::int`,
        categoryId: sql<string | null>`(array_agg(${tx.categoryId}))[1]`,
      })
      .from(tx)
      .where(
        and(
          isNull(tx.deletedAt),
          inArray(tx.kind, ['expense', 'refund']),
          between(tx.competenceDate, first, endOfMonth(lastFull)),
        ),
      )
      .groupBy(tx.descriptionNorm, sql`2`),
    db.select({ norm: merchant.descriptionNorm, name: merchant.displayName }).from(merchant),
    listCategories(true),
  ]);
  const [inc] = await db
    .select({ total: sql<number>`coalesce(sum(${tx.amountCents}), 0)::bigint` })
    .from(tx)
    .where(
      and(
        isNull(tx.deletedAt),
        eq(tx.kind, 'income'),
        between(tx.cashDate, first, endOfMonth(lastFull)),
      ),
    );
  const monthlyIncome = Number(inc?.total ?? 0) / months.length;

  const byKey = new Map<string, typeof rows>();
  for (const r of rows) byKey.set(r.norm, [...(byKey.get(r.norm) ?? []), r]);
  const names = new Map(merchants.map((m) => [m.norm, m.name]));
  const groups: NatureGroup[] = [];
  for (const [key, pts] of byKey) {
    const stats = analyzeGroup(
      pts
        .filter((p) => Number(p.cents) > 0)
        .map((p) => ({ month: p.month, cents: Number(p.cents), count: p.count })),
      months,
    );
    if (stats.monthsPresent === 0) continue;
    const catId = pts.find((p) => p.categoryId)?.categoryId;
    const cat = catId ? cats.find((c) => c.id === catId) : undefined;
    groups.push({
      key,
      name: names.get(key) ?? key,
      categoryLabel: cat ? categoryLabel(cat, cats) : null,
      stats,
      shareOfIncome:
        monthlyIncome > 0 ? Math.round((stats.avg12 / monthlyIncome) * 1000) / 1000 : null,
    });
  }
  const totals = (n: Nature) => {
    const g = groups.filter((x) => x.stats.nature === n);
    const avg12 = g.reduce((s, x) => s + x.stats.avg12, 0);
    return {
      count: g.length,
      avg12,
      avg3: g.reduce((s, x) => s + x.stats.avg3, 0),
      shareOfIncome: monthlyIncome > 0 ? avg12 / monthlyIncome : null,
    };
  };
  return {
    months,
    monthlyIncomeCents: Math.round(monthlyIncome),
    groups: groups.sort((a, b) => b.stats.avg12 - a.stats.avg12),
    totals: {
      fixed: totals('fixed'),
      variable_recurring: totals('variable_recurring'),
      eventual: totals('eventual'),
    },
  };
}
