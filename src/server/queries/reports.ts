import 'server-only';
import { and, asc, between, eq, isNull, sql } from 'drizzle-orm';
import {
  addMonths,
  endOfMonth,
  minDate,
  startOfMonth,
  todaySP,
  ymd,
  type LocalDate,
} from '@/domain/dates/local-date';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { getAppSettings } from '@/server/services/settings';
import { categoryLabel, listCategories, type CategoryRow } from '@/server/services/categories';
import { categoryBreakdown } from './categories';
import { getBudgets } from './planning';
import { summarize } from './transactions';

const { transaction: tx, account, netWorthSnapshot } = schema;

function labelOf(id: string | null, cats: CategoryRow[]) {
  if (!id) return 'Sem categoria';
  const c = cats.find((x) => x.id === id);
  return c ? categoryLabel(c, cats) : 'Sem categoria';
}

/** Relatório de um mês (competência): resumo, comparação com o mês anterior, categorias e destaques. */
export async function getMonthlyReport(month: LocalDate) {
  await requireUnlocked();
  const today = todaySP();
  const start = startOfMonth(month);
  const end = minDate(endOfMonth(start), today);
  const prevStart = addMonths(start, -1);
  const prevEnd = endOfMonth(prevStart);
  const [cur, prev, cats, curCats, prevCats, budgets, settings, biggest, snaps] = await Promise.all(
    [
      summarize(start, end, 'accrual'),
      summarize(prevStart, prevEnd, 'accrual'),
      listCategories(true),
      categoryBreakdown(start, end, 'accrual'),
      categoryBreakdown(prevStart, prevEnd, 'accrual'),
      getBudgets(start),
      getAppSettings(),
      getDb()
        .select({
          id: tx.id,
          date: tx.competenceDate,
          description: sql<string>`coalesce(${tx.userDescription}, ${tx.srcDescription})`,
          amountCents: tx.amountCents,
          accountName: account.name,
          categoryId: tx.categoryId,
        })
        .from(tx)
        .innerJoin(account, eq(tx.accountId, account.id))
        .where(
          and(isNull(tx.deletedAt), eq(tx.kind, 'expense'), between(tx.competenceDate, start, end)),
        )
        .orderBy(asc(tx.amountCents))
        .limit(5),
      getDb()
        .select({ date: netWorthSnapshot.date, netCents: netWorthSnapshot.netCents })
        .from(netWorthSnapshot)
        .where(between(netWorthSnapshot.date, addMonths(start, -1), end))
        .orderBy(asc(netWorthSnapshot.date)),
    ],
  );

  // categorias somadas por rótulo (subcategorias ficam separadas, como na análise)
  const byLabel = new Map<string, { cur: number; prev: number }>();
  for (const r of curCats) {
    const k = labelOf(r.categoryId, cats);
    byLabel.set(k, { cur: (byLabel.get(k)?.cur ?? 0) + r.cents, prev: byLabel.get(k)?.prev ?? 0 });
  }
  for (const r of prevCats) {
    const k = labelOf(r.categoryId, cats);
    byLabel.set(k, { cur: byLabel.get(k)?.cur ?? 0, prev: (byLabel.get(k)?.prev ?? 0) + r.cents });
  }
  const categories = [...byLabel.entries()]
    .map(([label, v]) => ({
      label,
      cents: v.cur,
      prevCents: v.prev,
      deltaCents: v.cur - v.prev,
    }))
    .filter((c) => c.cents > 0 || c.prevCents > 0)
    .sort((a, b) => b.cents - a.cents);

  const leftover = cur.incomeCents - cur.expenseCents;
  const before = snaps.filter((s) => s.date < start).at(-1) ?? snaps[0];
  const after = snaps.at(-1);
  return {
    month: start,
    end,
    partial: end < endOfMonth(start),
    summary: { ...cur, leftoverCents: leftover },
    previous: { ...prev, leftoverCents: prev.incomeCents - prev.expenseCents },
    savingsRate: cur.incomeCents > 0 ? leftover / cur.incomeCents : null,
    savingsGoal: settings.savingsGoalPct / 100,
    categories,
    biggest: biggest.map((b) => ({
      ...b,
      amountCents: -b.amountCents,
      category: b.categoryId ? labelOf(b.categoryId, cats) : null,
    })),
    budgets: {
      total: budgets.length,
      over: budgets.filter((b) => b.pace.usedRatio > 1).map((b) => b.label),
    },
    netWorth:
      before && after && before.date !== after.date
        ? { from: before.date, to: after.date, deltaCents: after.netCents - before.netCents }
        : null,
  };
}

/** Visão anual: receita, gasto, aplicado e sobra mês a mês (competência), com as maiores categorias. */
export async function getYearReport(year: number) {
  await requireUnlocked();
  const today = todaySP();
  const cats = await listCategories(true);
  const months = [];
  const catTotals = new Map<string, number[]>();
  for (let m = 1; m <= 12; m++) {
    const start = ymd(year, m, 1);
    if (start > today) break;
    const end = minDate(endOfMonth(start), today);
    const [s, c] = await Promise.all([
      summarize(start, end, 'accrual'),
      categoryBreakdown(start, end, 'accrual'),
    ]);
    months.push({
      month: start,
      partial: end < endOfMonth(start),
      ...s,
      leftoverCents: s.incomeCents - s.expenseCents,
    });
    for (const r of c) {
      const k = labelOf(r.categoryId, cats);
      const arr = catTotals.get(k) ?? Array<number>(12).fill(0);
      arr[m - 1] = (arr[m - 1] ?? 0) + r.cents;
      catTotals.set(k, arr);
    }
  }
  const total = months.reduce(
    (t, m) => ({
      incomeCents: t.incomeCents + m.incomeCents,
      expenseCents: t.expenseCents + m.expenseCents,
      investedCents: t.investedCents + m.investedCents,
      leftoverCents: t.leftoverCents + m.leftoverCents,
    }),
    { incomeCents: 0, expenseCents: 0, investedCents: 0, leftoverCents: 0 },
  );
  const categories = [...catTotals.entries()]
    .map(([label, byMonth]) => ({
      label,
      byMonth: byMonth.slice(0, months.length),
      totalCents: byMonth.reduce((a, b) => a + b, 0),
    }))
    .filter((c) => c.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents);
  return {
    year,
    months,
    total,
    averageExpenseCents: months.length ? Math.round(total.expenseCents / months.length) : 0,
    categories,
  };
}

/** Linhas para exportar (CSV): todas as transações do período, com conta, categoria e tipo. */
export async function exportTransactions(
  from: LocalDate,
  to: LocalDate,
  basis: 'cash' | 'accrual',
) {
  await requireUnlocked();
  const dateCol = basis === 'cash' ? tx.cashDate : tx.competenceDate;
  const [rows, cats] = await Promise.all([
    getDb()
      .select({
        date: dateCol,
        purchaseDate: tx.competenceDate,
        description: sql<string>`coalesce(${tx.userDescription}, ${tx.srcDescription})`,
        amountCents: tx.amountCents,
        kind: tx.kind,
        categoryId: tx.categoryId,
        accountName: account.name,
        installmentNumber: tx.installmentNumber,
        installmentTotal: tx.installmentTotal,
        status: tx.status,
        notes: tx.notes,
        tags: tx.tags,
      })
      .from(tx)
      .innerJoin(account, eq(tx.accountId, account.id))
      .where(and(isNull(tx.deletedAt), between(dateCol, from, to)))
      .orderBy(asc(dateCol), asc(tx.date), asc(tx.id)),
    listCategories(true),
  ]);
  return rows.map((r) => ({ ...r, category: r.categoryId ? labelOf(r.categoryId, cats) : null }));
}
