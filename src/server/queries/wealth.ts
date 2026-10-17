import 'server-only';
import { and, asc, desc, eq, gte, isNull, ne } from 'drizzle-orm';
import { addDays, addMonths, todaySP, toLocalDateSP } from '@/domain/dates/local-date';
import { emergencyCoverage, goalProgress } from '@/domain/goals/progress';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { getAppSettings } from '@/server/services/settings';
import { listCategories, categoryLabel } from '@/server/services/categories';
import { currentRates } from '@/server/services/rates';
import { takeNetWorthSnapshot } from '@/server/services/wealth';
import { getNatureAnalysis } from './planning';

const { investment, institutionConnection, goal, netWorthSnapshot, recurringItem } = schema;

/** Patrimônio atual (grava o retrato do dia) e a evolução dos últimos 12 meses. */
export async function getWealthView() {
  await requireUnlocked();
  const today = todaySP();
  const now = await takeNetWorthSnapshot(today);
  const history = await getDb()
    .select()
    .from(netWorthSnapshot)
    .where(gte(netWorthSnapshot.date, addMonths(today, -12)))
    .orderBy(asc(netWorthSnapshot.date));
  const first = history[0];
  const monthAgo = [...history].reverse().find((h) => h.date <= addDays(today, -30));
  return {
    today,
    now,
    history: history.map((h) => ({
      date: h.date,
      netCents: h.netCents,
      cashCents: h.cashCents,
      investmentsCents: h.investmentsCents,
      cardDebtCents: h.cardDebtCents,
    })),
    changeSinceStart: first ? { since: first.date, cents: now.netCents - first.netCents } : null,
    change30d: monthAgo ? { since: monthAgo.date, cents: now.netCents - monthAgo.netCents } : null,
  };
}

/** Investimentos, metas, reserva de emergência e taxas de referência. */
export async function getSavingsView() {
  await requireUnlocked();
  const db = getDb();
  const today = todaySP();
  const [invs, goals, rates, settings, nature, cash] = await Promise.all([
    db
      .select({ i: investment, institution: institutionConnection.connectorName })
      .from(investment)
      .innerJoin(institutionConnection, eq(investment.connectionId, institutionConnection.id))
      .where(and(isNull(investment.deletedAt), isNull(institutionConnection.deletedAt)))
      .orderBy(desc(investment.netCents)),
    db.select().from(goal).where(ne(goal.status, 'archived')).orderBy(asc(goal.createdAt)),
    currentRates(),
    getAppSettings(),
    getNatureAnalysis(),
    takeNetWorthSnapshot(today),
  ]);
  const investments = invs.map(({ i, institution }) => ({
    id: i.id,
    name: i.name,
    institution,
    issuer: i.issuer,
    type: i.type,
    subtype: i.subtype,
    rate: i.rate,
    rateType: i.rateType,
    fixedAnnualRate: i.fixedAnnualRate,
    netCents: i.netCents,
    grossCents: i.grossCents,
    taxesCents: i.taxesCents,
    profitCents: i.profitCents,
    dueDate: i.dueDate,
  }));
  const investedCents = investments.reduce((s, i) => s + i.netCents, 0);
  const essential = nature.totals.fixed.avg3 + nature.totals.variable_recurring.avg3;
  const liquid = Math.max(0, cash.cashCents) + investedCents;
  return {
    today,
    rates,
    investments,
    investedCents,
    goals: goals.map((g) => {
      const inv = g.investmentId ? investments.find((i) => i.id === g.investmentId) : undefined;
      const saved = inv ? inv.netCents : g.manualSavedCents;
      return {
        ...g,
        investmentName: inv?.name ?? null,
        progress: goalProgress({
          targetCents: g.targetCents,
          savedCents: saved,
          createdOn: toLocalDateSP(g.createdAt),
          targetDate: (g.targetDate as typeof today | null) ?? null,
          today,
        }),
      };
    }),
    emergency: {
      monthlyEssentialCents: essential,
      liquidCents: liquid,
      targetMonths: settings.emergencyMonths,
      ...emergencyCoverage(liquid, essential, settings.emergencyMonths),
    },
  };
}

/** Assinaturas: recorrências marcadas como assinatura, com total anual, mudança de preço e novidades. */
export async function getSubscriptionsView() {
  await requireUnlocked();
  const today = todaySP();
  const [items, cats] = await Promise.all([
    getDb()
      .select()
      .from(recurringItem)
      .where(and(eq(recurringItem.isSubscription, true), ne(recurringItem.status, 'ignored')))
      .orderBy(desc(recurringItem.amountCents)),
    listCategories(true),
  ]);
  const monthly = (i: (typeof items)[number]) =>
    i.periodicity === 'monthly'
      ? i.amountCents
      : i.periodicity === 'weekly'
        ? Math.round((i.amountCents * 52) / 12)
        : Math.round(i.amountCents / 12);
  const list = items
    .filter((i) => i.direction === 'out')
    .map((i) => {
      const c = i.categoryId ? cats.find((x) => x.id === i.categoryId) : undefined;
      const last = i.lastAmountCents;
      return {
        id: i.id,
        name: i.name,
        status: i.status,
        periodicity: i.periodicity,
        amountCents: i.amountCents,
        monthlyCents: monthly(i),
        annualCents: monthly(i) * 12,
        category: c ? categoryLabel(c, cats) : null,
        lastSeenDate: i.lastSeenDate,
        priceChange:
          last != null && Math.abs(last - i.amountCents) > Math.max(100, i.amountCents * 0.02)
            ? { fromCents: i.amountCents, toCents: last }
            : null,
        isNew: i.startDate >= addDays(today, -60),
        stale: i.lastSeenDate != null && i.lastSeenDate < addDays(today, -45),
      };
    });
  // com mudança de preço, vale o último valor cobrado
  const current = (i: (typeof list)[number]) =>
    i.priceChange
      ? Math.round((i.monthlyCents * i.priceChange.toCents) / i.priceChange.fromCents)
      : i.monthlyCents;
  const active = list.filter((i) => !i.stale);
  const monthlyCents = active.reduce((s, i) => s + current(i), 0);
  // recorrências de saída confirmadas que ainda não estão marcadas (para a pessoa marcar)
  const others = await getDb()
    .select({
      id: recurringItem.id,
      name: recurringItem.name,
      amountCents: recurringItem.amountCents,
      periodicity: recurringItem.periodicity,
    })
    .from(recurringItem)
    .where(
      and(
        eq(recurringItem.isSubscription, false),
        eq(recurringItem.status, 'confirmed'),
        eq(recurringItem.direction, 'out'),
      ),
    )
    .orderBy(asc(recurringItem.name));
  return { items: list, monthlyCents, annualCents: monthlyCents * 12, others };
}
