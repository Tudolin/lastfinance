import 'server-only';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { todaySP, type LocalDate } from '@/domain/dates/local-date';
import { netForGross, salaryAt } from '@/domain/income/generate';
import { describePaymentRule } from '@/domain/income/payment-rule';
import { multipleEmployments } from '@/domain/tax/clt';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { categoryLabel, listCategories } from '@/server/services/categories';
import { loadAccountRefs, loadIncomeDefs } from '@/server/services/planning';
import { taxTablesResolver } from '@/server/services/tax-tables';

const { forecastEntry, recurringItem, plannedExpense } = schema;

export async function getAccountOptions() {
  await requireUnlocked();
  const accounts = await loadAccountRefs();
  return [...accounts.values()].map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
}

export async function getIncomeView() {
  await requireUnlocked();
  const today = todaySP();
  const db = getDb();
  const [defs, { tablesFor, fallbacksFor, rows }, accounts, upcoming] = await Promise.all([
    loadIncomeDefs(),
    taxTablesResolver(),
    getAccountOptions(),
    db
      .select()
      .from(forecastEntry)
      .where(and(eq(forecastEntry.sourceType, 'income'), gte(forecastEntry.expectedDate, today)))
      .orderBy(asc(forecastEntry.expectedDate))
      .limit(60),
  ]);
  const tables = tablesFor(today);
  const sources = defs.map((d) => {
    const gross = salaryAt(d, today) ?? d.salaryHistory.at(-1)?.grossCents ?? 0;
    const calc = netForGross(d, gross, tables);
    const eventIds = new Set(d.events.map((e) => e.id));
    return {
      def: d,
      gross,
      calc,
      ruleText: describePaymentRule(d.paymentRule),
      accountName: accounts.find((a) => a.id === d.accountId)?.name ?? null,
      next: upcoming.filter((u) => u.sourceId === d.id || eventIds.has(u.sourceId)).slice(0, 4),
      history: [...d.salaryHistory].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1)),
    };
  });
  const clt = defs.filter((d) => d.type === 'clt' && d.active);
  const annual =
    clt.length > 0
      ? multipleEmployments(
          clt.map((d) => ({ gross: salaryAt(d, today) ?? 0, ...d.deductions })),
          tables,
        )
      : null;
  const totalNet = sources
    .filter((s) => s.def.active)
    .reduce((s, x) => s + Math.round(x.calc.net * x.def.calibrationFactor), 0);
  return {
    today,
    sources,
    annual,
    multipleClt: clt.length > 1,
    totalNet,
    accounts,
    tables,
    fallbacks: fallbacksFor(today),
    verifiedAt: rows.reduce(
      (m, r) => (r.verifiedAt > m ? r.verifiedAt : m),
      '' as string,
    ) as LocalDate,
  };
}

export async function getRecurringView() {
  await requireUnlocked();
  const db = getDb();
  const [items, cats, accounts] = await Promise.all([
    db.select().from(recurringItem).orderBy(desc(recurringItem.amountCents)),
    listCategories(true),
    getAccountOptions(),
  ]);
  const withLabels = items.map((i) => {
    const c = i.categoryId ? cats.find((x) => x.id === i.categoryId) : undefined;
    return {
      ...i,
      categoryLabel: c ? categoryLabel(c, cats) : null,
      accountName: accounts.find((a) => a.id === i.accountId)?.name ?? null,
    };
  });
  return {
    suggested: withLabels.filter((i) => i.status === 'suggested'),
    confirmed: withLabels.filter((i) => i.status === 'confirmed'),
    ignored: withLabels.filter((i) => i.status === 'ignored'),
    accounts,
    monthlyOut: withLabels
      .filter((i) => i.status === 'confirmed' && i.direction === 'out')
      .reduce(
        (s, i) =>
          s +
          (i.periodicity === 'monthly'
            ? i.amountCents
            : i.periodicity === 'weekly'
              ? Math.round((i.amountCents * 52) / 12)
              : Math.round(i.amountCents / 12)),
        0,
      ),
  };
}

export async function getPlannedView() {
  await requireUnlocked();
  const db = getDb();
  const [items, accounts, cats] = await Promise.all([
    db.select().from(plannedExpense).orderBy(asc(plannedExpense.date)),
    getAccountOptions(),
    listCategories(true),
  ]);
  const entries = items.length
    ? await db
        .select({
          sourceId: forecastEntry.sourceId,
          cashDate: forecastEntry.cashDate,
          cents: forecastEntry.expectedCents,
          status: forecastEntry.status,
        })
        .from(forecastEntry)
        .where(
          and(
            eq(forecastEntry.sourceType, 'planned'),
            inArray(
              forecastEntry.sourceId,
              items.map((i) => i.id),
            ),
          ),
        )
    : [];
  return {
    items: items.map((i) => {
      const c = i.categoryId ? cats.find((x) => x.id === i.categoryId) : undefined;
      return {
        ...i,
        accountName: accounts.find((a) => a.id === i.accountId)?.name ?? null,
        categoryLabel: c ? categoryLabel(c, cats) : null,
        cash: entries
          .filter((e) => e.sourceId === i.id)
          .sort((a, b) => (a.cashDate < b.cashDate ? -1 : 1)),
      };
    }),
    accounts,
  };
}
