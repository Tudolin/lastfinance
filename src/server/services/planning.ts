import 'server-only';
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { cashDateForDue, cycleForPurchase } from '@/domain/cards/billing-cycle';
import { projectFutureInstallments, type FutureInstallment } from '@/domain/cards/installments';
import { bankingCalendar } from '@/domain/dates/business-days';
import {
  addDays,
  addMonths,
  endOfMonth,
  startOfMonth,
  todaySP,
  type LocalDate,
} from '@/domain/dates/local-date';
import {
  installmentDrafts,
  plannedDrafts,
  recurringDrafts,
  type AccountRef,
  type RecurringDef,
} from '@/domain/forecast/drafts';
import { calibrationFactor, entryStatus, reconcile } from '@/domain/forecast/match';
import type { CashEvent, ProjectionInput } from '@/domain/forecast/project';
import type { ForecastDraft } from '@/domain/forecast/types';
import { incomeDrafts, type IncomeSourceDef } from '@/domain/income/generate';
import { paymentRuleSchema } from '@/domain/income/payment-rule';
import { detectRecurrences } from '@/domain/recurrence/detect';
import type { PjConfig } from '@/domain/tax/pj';
import type { CltDeductions } from '@/domain/tax/clt';
import { getDb, schema } from '@/server/db/client';
import { log } from '@/server/log';
import { getAppSettings } from './settings';
import { taxTablesResolver } from './tax-tables';

const {
  account,
  institutionConnection,
  transaction: tx,
  creditCardBill,
  incomeSource,
  incomeSalaryHistory,
  incomeEvent,
  recurringItem,
  plannedExpense,
  forecastEntry,
  forecastMatch,
  merchant,
  category,
  budget,
} = schema;

export const GENERATOR_VERSION = 1;
/** Janela gerada: 3 meses para trás (Planejado × Realizado) e 12 para a frente. */
const PAST_DAYS = 92;
const FUTURE_DAYS = 366;

// ───────────────────────── Leitura das definições ─────────────────────────

export async function loadAccountRefs(): Promise<
  Map<string, AccountRef & { name: string; includeInCash: boolean; balanceCents: number }>
> {
  const rows = await getDb()
    .select({ a: account })
    .from(account)
    .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
    .where(and(eq(account.isActive, true), isNull(institutionConnection.deletedAt)));
  return new Map(
    rows.map(({ a }) => [
      a.id,
      {
        id: a.id,
        kind: a.kind,
        name: a.displayName ?? a.name,
        includeInCash: a.includeInCash,
        balanceCents: a.balanceCents,
        cycle: a.closingDay && a.dueDay ? { closingDay: a.closingDay, dueDay: a.dueDay } : null,
      },
    ]),
  );
}

export async function loadIncomeDefs(): Promise<IncomeSourceDef[]> {
  const db = getDb();
  const [sources, history, events] = await Promise.all([
    db.select().from(incomeSource),
    db.select().from(incomeSalaryHistory),
    db.select().from(incomeEvent),
  ]);
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    accountId: s.accountId,
    categoryId: s.categoryId,
    matchPattern: s.matchPattern ?? s.employerName,
    startDate: s.startDate as LocalDate,
    endDate: s.endDate as LocalDate | null,
    active: s.status === 'active',
    paymentRule: paymentRuleSchema.parse(s.paymentRule),
    deductions: (s.deductions ?? {}) as CltDeductions,
    pjConfig: (s.pjConfig ?? null) as PjConfig | null,
    prorateFirstMonth: s.prorateFirstMonth,
    salaryHistory: history
      .filter((h) => h.incomeSourceId === s.id)
      .map((h) => ({
        grossCents: h.grossCents,
        validFrom: h.validFrom as LocalDate,
        validTo: h.validTo as LocalDate | null,
      })),
    events: events
      .filter((e) => e.incomeSourceId === s.id)
      .map((e) => ({
        id: e.id,
        type: e.type,
        expectedDate: e.expectedDate as LocalDate,
        grossCents: e.grossCents,
        netCents: e.netCents,
        vacationDays: e.vacationDays,
      })),
    calibrationFactor: s.forecastMode === 'calibrated' ? s.calibrationFactor : 1,
    forecastMode: s.forecastMode,
  }));
}

async function loadRecurringDefs(accounts: Map<string, AccountRef>): Promise<RecurringDef[]> {
  const rows = await getDb()
    .select()
    .from(recurringItem)
    .where(eq(recurringItem.status, 'confirmed'));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    direction: r.direction,
    account: r.accountId ? (accounts.get(r.accountId) ?? null) : null,
    categoryId: r.categoryId,
    descriptionNorm: r.matchPattern ?? r.descriptionNorm,
    amountCents: r.amountCents,
    tolerancePct: r.tolerancePct,
    nature: r.nature,
    periodicity: r.periodicity,
    anchorDay: r.anchorDay,
    anchorMonth: r.anchorMonth,
    startDate: r.startDate as LocalDate,
    endDate: r.endDate as LocalDate | null,
  }));
}

/** Parcelas futuras de compras parceladas já lançadas nos cartões. */
export async function loadFutureInstallments(today: LocalDate): Promise<FutureInstallment[]> {
  const db = getDb();
  const cards = await db
    .select({ id: account.id, dueDay: account.dueDay })
    .from(account)
    .where(and(eq(account.kind, 'credit_card'), eq(account.isActive, true)));
  if (cards.length === 0) return [];
  const rows = await db
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
        inArray(
          tx.accountId,
          cards.map((c) => c.id),
        ),
        isNull(tx.deletedAt),
        isNotNull(tx.installmentNumber),
        eq(tx.kind, 'expense'),
      ),
    );
  return projectFutureInstallments(
    rows.map((r) => ({
      accountId: r.accountId,
      baseDescription: r.descriptionNorm,
      amountCents: r.amountCents,
      installmentNumber: r.n!,
      installmentTotal: r.total!,
      dueDate: (r.billDue ?? r.cashDate) as LocalDate,
    })),
    new Map(cards.filter((c) => c.dueDay).map((c) => [c.id, c.dueDay!])),
  ).filter((f) => f.dueDate > today);
}

// ───────────────────────── Geração (idempotente) ─────────────────────────

async function upsertDrafts(drafts: ForecastDraft[]) {
  const db = getDb();
  for (let i = 0; i < drafts.length; i += 300) {
    const chunk = drafts.slice(i, i + 300).map((d) => ({
      sourceType: d.sourceType,
      sourceId: d.sourceId,
      direction: d.direction,
      accountId: d.accountId,
      categoryId: d.categoryId,
      label: d.label,
      expectedDate: d.expectedDate,
      cashDate: d.cashDate,
      windowStart: d.windowStart,
      windowEnd: d.windowEnd,
      expectedCents: d.expectedCents,
      lowCents: d.lowCents,
      highCents: d.highCents,
      tolerancePct: d.tolerancePct,
      matchPattern: d.matchPattern,
      certainty: d.certainty,
      calcBreakdown: d.breakdown ?? null,
      generatedAt: new Date(),
      generatorVersion: GENERATOR_VERSION,
    }));
    await db
      .insert(forecastEntry)
      .values(chunk)
      .onConflictDoUpdate({
        target: [forecastEntry.sourceType, forecastEntry.sourceId, forecastEntry.expectedDate],
        set: {
          direction: sql`excluded.direction`,
          accountId: sql`excluded.account_id`,
          categoryId: sql`excluded.category_id`,
          label: sql`excluded.label`,
          cashDate: sql`excluded.cash_date`,
          windowStart: sql`excluded.window_start`,
          windowEnd: sql`excluded.window_end`,
          expectedCents: sql`excluded.expected_cents`,
          lowCents: sql`excluded.low_cents`,
          highCents: sql`excluded.high_cents`,
          tolerancePct: sql`excluded.tolerance_pct`,
          matchPattern: sql`excluded.match_pattern`,
          certainty: sql`excluded.certainty`,
          calcBreakdown: sql`excluded.calc_breakdown`,
          generatedAt: sql`excluded.generated_at`,
          generatorVersion: sql`excluded.generator_version`,
          updatedAt: new Date(),
        },
        // O que já aconteceu é história: um realizado não muda quando a regra muda.
        setWhere: ne(forecastEntry.status, 'realizado'),
      });
  }
}

/**
 * Regenera os previstos de todas as fontes. Idempotente: a chave (tipo, fonte, data) preserva as
 * situações já resolvidas; previstos que a regra não gera mais (e sem par) são apagados.
 */
export async function regenerateForecast(today: LocalDate = todaySP()) {
  const db = getDb();
  const from = addDays(today, -PAST_DAYS);
  const to = addDays(today, FUTURE_DAYS);
  const [accounts, incomes, { tablesFor }, planned, installments] = await Promise.all([
    loadAccountRefs(),
    loadIncomeDefs(),
    taxTablesResolver(),
    db.select().from(plannedExpense).where(eq(plannedExpense.status, 'planned')),
    loadFutureInstallments(today),
  ]);
  const recurring = await loadRecurringDefs(accounts);

  const drafts: ForecastDraft[] = [
    ...incomes.flatMap((s) => incomeDrafts(s, from, to, tablesFor)),
    ...recurring.flatMap((r) => recurringDrafts(r, from, to)),
    ...planned.flatMap((p) =>
      plannedDrafts({
        id: p.id,
        description: p.description,
        amountCents: p.amountCents,
        date: p.date as LocalDate,
        account: p.accountId ? (accounts.get(p.accountId) ?? null) : null,
        paymentMethod: p.paymentMethod,
        installments: p.installments,
        categoryId: p.categoryId,
      }),
    ),
    ...installmentDrafts(installments),
  ];
  // Duas partes do salário no mesmo dia viram uma só entrada.
  const unique = new Map<string, ForecastDraft>();
  for (const d of drafts) {
    const key = `${d.sourceType}|${d.sourceId}|${d.expectedDate}`;
    const prev = unique.get(key);
    unique.set(
      key,
      prev
        ? {
            ...prev,
            expectedCents: prev.expectedCents + d.expectedCents,
            lowCents: prev.lowCents + d.lowCents,
            highCents: prev.highCents + d.highCents,
          }
        : d,
    );
  }
  const all = [...unique.values()];
  await upsertDrafts(all);

  // Limpeza: o que não foi gerado agora e não tem par ativo sai.
  const keep = new Set(all.map((d) => `${d.sourceType}|${d.sourceId}|${d.expectedDate}`));
  const existing = await db
    .select({
      id: forecastEntry.id,
      sourceType: forecastEntry.sourceType,
      sourceId: forecastEntry.sourceId,
      expectedDate: forecastEntry.expectedDate,
      matched: sql<boolean>`exists (select 1 from ${forecastMatch} m where m.forecast_entry_id = "forecast_entry"."id" and m.unmatched_at is null)`,
    })
    .from(forecastEntry)
    .where(
      or(
        inArray(forecastEntry.sourceType, ['planned', 'installment']),
        and(gte(forecastEntry.expectedDate, from), lte(forecastEntry.expectedDate, to)),
      ),
    );
  const stale = existing
    .filter((e) => !e.matched && !keep.has(`${e.sourceType}|${e.sourceId}|${e.expectedDate}`))
    .map((e) => e.id);
  for (let i = 0; i < stale.length; i += 500)
    await db.delete(forecastEntry).where(inArray(forecastEntry.id, stale.slice(i, i + 500)));
  return { generated: all.length, removed: stale.length };
}

// ───────────────────────── Conciliação ─────────────────────────

export async function reconcileForecast(today: LocalDate = todaySP()) {
  const db = getDb();
  const from = addDays(today, -PAST_DAYS - 15);
  const [entries, matches] = await Promise.all([
    db
      .select()
      .from(forecastEntry)
      .where(
        and(
          ne(forecastEntry.sourceType, 'installment'),
          gte(forecastEntry.windowEnd, from),
          lte(forecastEntry.windowStart, today),
        ),
      ),
    db.select().from(forecastMatch),
  ]);
  const active = matches.filter((m) => !m.unmatchedAt);
  const matchedEntryIds = new Set(active.map((m) => m.forecastEntryId));
  const matchedTxIds = new Set(active.map((m) => m.transactionId));
  const rejectedPairs = new Set(
    matches.filter((m) => m.unmatchedAt).map((m) => `${m.forecastEntryId}|${m.transactionId}`),
  );
  const open = entries.filter((e) => !matchedEntryIds.has(e.id) && e.status !== 'cancelado');
  let created = 0;
  if (open.length) {
    const minStart = open.reduce(
      (m, e) => (e.windowStart < m ? e.windowStart : m),
      today as string,
    );
    const txs = await db
      .select({
        id: tx.id,
        accountId: tx.accountId,
        date: tx.date,
        amountCents: tx.amountCents,
        description: tx.srcDescription,
        kind: tx.kind,
      })
      .from(tx)
      .where(
        and(
          isNull(tx.deletedAt),
          inArray(tx.kind, ['income', 'expense']),
          gte(tx.date, minStart),
          lte(tx.date, today),
        ),
      );
    const found = reconcile(
      open.map((e) => ({
        id: e.id,
        sourceType: e.sourceType,
        direction: e.direction,
        accountId: e.accountId,
        expectedDate: e.expectedDate as LocalDate,
        windowStart: e.windowStart as LocalDate,
        windowEnd: e.windowEnd as LocalDate,
        expectedCents: e.userOverrideCents ?? e.expectedCents,
        tolerancePct: e.tolerancePct,
        matchPattern: e.matchPattern,
      })),
      txs.map((t) => ({ ...t, date: t.date as LocalDate })),
      { matchedEntryIds, matchedTxIds, rejectedPairs },
    );
    const byTx = new Map(txs.map((t) => [t.id, t]));
    const byEntry = new Map(open.map((e) => [e.id, e]));
    for (const m of found) {
      const e = byEntry.get(m.entryId)!;
      const t = byTx.get(m.txId)!;
      await db
        .insert(forecastMatch)
        .values({
          forecastEntryId: m.entryId,
          transactionId: m.txId,
          matchedBy: 'auto',
          score: m.score,
          expectedCents: e.userOverrideCents ?? e.expectedCents,
          actualCents: Math.abs(t.amountCents),
          deltaCents: m.deltaCents,
        })
        .onConflictDoNothing();
      matchedEntryIds.add(m.entryId);
      created++;
    }
  }
  await refreshStatuses(today);
  return { matched: created };
}

/** Atualiza a situação de todos os previstos (realizado/atrasado/previsto) numa só passada. */
export async function refreshStatuses(today: LocalDate = todaySP()) {
  const db = getDb();
  const rows = await db
    .select({
      id: forecastEntry.id,
      status: forecastEntry.status,
      windowEnd: forecastEntry.windowEnd,
      sourceType: forecastEntry.sourceType,
      matched: sql<boolean>`exists (select 1 from ${forecastMatch} m where m.forecast_entry_id = "forecast_entry"."id" and m.unmatched_at is null)`,
    })
    .from(forecastEntry)
    .where(lte(forecastEntry.windowStart, addDays(today, 1)));
  const changes = new Map<string, string[]>();
  for (const r of rows) {
    // Parcelas do cartão não se conciliam uma a uma: passada a data, viram realizadas na fatura.
    const next =
      r.sourceType === 'installment'
        ? r.windowEnd < today
          ? 'realizado'
          : 'previsto'
        : entryStatus({ windowEnd: r.windowEnd as LocalDate, status: r.status }, r.matched, today);
    if (next !== r.status) changes.set(next, [...(changes.get(next) ?? []), r.id]);
  }
  for (const [status, ids] of changes)
    for (let i = 0; i < ids.length; i += 500)
      await db
        .update(forecastEntry)
        .set({ status: status as typeof forecastEntry.$inferSelect.status })
        .where(inArray(forecastEntry.id, ids.slice(i, i + 500)));
}

/** Calibração: rendas em modo "calibrado" aprendem o fator real ÷ previsto das últimas conciliações. */
export async function calibrateIncomes() {
  const db = getDb();
  const sources = await db
    .select({ id: incomeSource.id, factor: incomeSource.calibrationFactor })
    .from(incomeSource)
    .where(eq(incomeSource.forecastMode, 'calibrated'));
  for (const s of sources) {
    const pairs = await db
      .select({
        expectedCents: forecastMatch.expectedCents,
        actualCents: forecastMatch.actualCents,
        factorUsed: sql<
          number | null
        >`(${forecastEntry.calcBreakdown}->>'calibrationFactor')::float`,
      })
      .from(forecastMatch)
      .innerJoin(forecastEntry, eq(forecastMatch.forecastEntryId, forecastEntry.id))
      .where(
        and(
          eq(forecastEntry.sourceType, 'income'),
          eq(forecastEntry.sourceId, s.id),
          isNull(forecastMatch.unmatchedAt),
        ),
      )
      .orderBy(forecastEntry.expectedDate);
    // Compara com o valor calculado SEM calibração, para o fator não se acumular.
    const factor = calibrationFactor(
      pairs.map((p) => ({
        expectedCents: Math.round(p.expectedCents / (p.factorUsed || 1)),
        actualCents: p.actualCents,
      })),
    );
    if (Math.abs(factor - s.factor) > 0.0001)
      await db
        .update(incomeSource)
        .set({ calibrationFactor: factor })
        .where(eq(incomeSource.id, s.id));
  }
}

// ───────────────────────── Recorrências ─────────────────────────

export async function detectRecurringSuggestions(today: LocalDate = todaySP()) {
  const db = getDb();
  const from = addMonths(today, -13);
  const [rows, merchants, incomes, cats] = await Promise.all([
    db
      .select({
        id: tx.id,
        accountId: tx.accountId,
        date: tx.competenceDate,
        amountCents: tx.amountCents,
        descriptionNorm: tx.descriptionNorm,
        categoryId: tx.categoryId,
      })
      .from(tx)
      .where(
        and(
          isNull(tx.deletedAt),
          inArray(tx.kind, ['expense', 'income']),
          gte(tx.competenceDate, from),
          or(isNull(tx.installmentTotal), lte(tx.installmentTotal, 1)),
        ),
      ),
    db.select({ norm: merchant.descriptionNorm, name: merchant.displayName }).from(merchant),
    db
      .select({ pattern: incomeSource.matchPattern, employer: incomeSource.employerName })
      .from(incomeSource),
    db.select({ id: category.id, slug: category.slug }).from(category),
  ]);
  const suggestions = detectRecurrences(
    rows.map((r) => ({ ...r, date: r.date as LocalDate })),
    today,
  );
  const names = new Map(merchants.map((m) => [m.norm, m.name]));
  const incomePatterns = incomes
    .flatMap((i) => [i.pattern, i.employer])
    .filter((p): p is string => !!p)
    .map((p) => p.toUpperCase());
  const subscriptionCats = new Set(cats.filter((c) => c.slug === 'assinaturas').map((c) => c.id));
  // Sugestões de entrada que já são uma fonte de renda cadastrada saem da lista.
  if (incomePatterns.length) {
    const open = await db
      .select({ id: recurringItem.id, norm: recurringItem.descriptionNorm })
      .from(recurringItem)
      .where(and(eq(recurringItem.status, 'suggested'), eq(recurringItem.direction, 'in')));
    const dup = open
      .filter((o) => o.norm && incomePatterns.some((p) => o.norm!.includes(p)))
      .map((o) => o.id);
    if (dup.length) await db.delete(recurringItem).where(inArray(recurringItem.id, dup));
  }
  let inserted = 0;
  for (const s of suggestions) {
    // Salário já é coberto pelas fontes de renda.
    if (s.direction === 'in' && incomePatterns.some((p) => s.descriptionNorm.includes(p))) continue;
    const stats = {
      occurrences: s.occurrences,
      cv: s.cv,
      confidence: s.confidence,
      lastDate: s.lastDate,
    };
    const r = await db
      .insert(recurringItem)
      .values({
        name: names.get(s.descriptionNorm) ?? titleCase(s.descriptionNorm),
        direction: s.direction,
        categoryId: s.categoryId,
        accountId: s.accountId,
        descriptionNorm: s.descriptionNorm,
        amountCents: s.amountCents,
        tolerancePct: s.tolerancePct,
        nature: s.nature,
        periodicity: s.periodicity,
        anchorDay: s.anchorDay,
        anchorMonth: s.anchorMonth,
        startDate: s.lastDate,
        status: 'suggested',
        detectionStats: stats,
        isSubscription: !!s.categoryId && subscriptionCats.has(s.categoryId),
        lastAmountCents: s.lastAmountCents,
        lastSeenDate: s.lastDate,
      })
      .onConflictDoUpdate({
        target: [recurringItem.descriptionNorm, recurringItem.direction],
        // Sugestão ainda aberta acompanha os dados; confirmada/ignorada só registra a última ocorrência.
        set: {
          lastAmountCents: s.lastAmountCents,
          lastSeenDate: s.lastDate,
          detectionStats: stats,
          amountCents: sql`case when ${recurringItem.status} = 'suggested' then ${s.amountCents} else ${recurringItem.amountCents} end`,
          tolerancePct: sql`case when ${recurringItem.status} = 'suggested' then ${s.tolerancePct}::real else ${recurringItem.tolerancePct} end`,
          updatedAt: new Date(),
        },
      })
      .returning({ createdAt: recurringItem.createdAt, updatedAt: recurringItem.updatedAt });
    if (r[0] && r[0].createdAt.getTime() === r[0].updatedAt.getTime()) inserted++;
  }
  return { suggestions: suggestions.length, inserted };
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Pipeline completo do Planejado, chamado depois de cada sincronização e de cada edição:
 * calibra → regenera → concilia → detecta recorrências.
 */
export async function refreshPlanning(today: LocalDate = todaySP()) {
  const t0 = Date.now();
  await calibrateIncomes();
  const gen = await regenerateForecast(today);
  const rec = await reconcileForecast(today);
  const det = await detectRecurringSuggestions(today);
  log.info('planejado atualizado', {
    ...gen,
    ...rec,
    suggestions: det.suggestions,
    ms: Date.now() - t0,
  });
  return { ...gen, ...rec, ...det };
}

// ───────────────────────── Entradas da projeção ─────────────────────────

export type ProjectionContext = {
  input: ProjectionInput;
  accounts: Awaited<ReturnType<typeof loadAccountRefs>>;
  nextIncome: LocalDate | null;
  variableMonthlyCents: number;
  variableSource: 'avg3' | 'avg6' | 'budget';
  reserveCents: number;
  cashAccounts: { id: string; name: string; balanceCents: number }[];
};

function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Monta a entrada do motor: saldo das contas, previstos em aberto (com os atrasados trazidos
 * para hoje), faturas a pagar (o que já foi gasto no cartão) e o gasto variável estimado.
 */
export async function buildProjectionContext(
  days: number,
  today: LocalDate = todaySP(),
): Promise<ProjectionContext> {
  const db = getDb();
  const settings = await getAppSettings();
  const accounts = await loadAccountRefs();
  const cash = [...accounts.values()].filter((a) => a.kind !== 'credit_card' && a.includeInCash);
  const cards = [...accounts.values()].filter((a) => a.kind === 'credit_card');
  const startBalance = cash.reduce((s, a) => s + a.balanceCents, 0);
  const end = addDays(today, Math.max(days, 1));
  const events: CashEvent[] = [];

  // 1) Previstos em aberto (os atrasados há até 45 dias entram hoje).
  const entries = await db
    .select()
    .from(forecastEntry)
    .where(
      and(
        inArray(forecastEntry.status, ['previsto', 'atrasado']),
        gte(forecastEntry.cashDate, addDays(today, -45)),
        lte(forecastEntry.cashDate, end),
      ),
    );
  let nextIncome: LocalDate | null = null;
  for (const e of entries) {
    const v = e.userOverrideCents ?? e.expectedCents;
    const overdue = e.status === 'atrasado';
    const isIn = e.direction === 'in';
    if (isIn && !overdue && e.cashDate > today && (!nextIncome || e.cashDate < nextIncome))
      nextIncome = e.cashDate as LocalDate;
    events.push({
      date: e.cashDate as LocalDate,
      cents: isIn ? v : -v,
      pessimisticCents: isIn ? (overdue ? 0 : e.lowCents) : -e.highCents,
      optimisticCents: isIn ? e.highCents : -e.lowCents,
      label: overdue ? `${e.label} (atrasado)` : e.label,
      kind: overdue ? 'overdue' : e.sourceType,
      accountId: e.accountId,
      estimated: e.certainty === 'estimated',
    });
  }

  // 2) Faturas: o que já foi gasto no cartão e ainda não foi pago sai no vencimento.
  if (cards.length) {
    const cardIds = cards.map((c) => c.id);
    const [posted, bills] = await Promise.all([
      db
        .select({
          accountId: tx.accountId,
          cashDate: tx.cashDate,
          cents: sql<number>`sum(${tx.amountCents})::bigint`,
        })
        .from(tx)
        .where(
          and(
            inArray(tx.accountId, cardIds),
            isNull(tx.deletedAt),
            ne(tx.kind, 'card_payment'),
            gte(tx.cashDate, today),
          ),
        )
        .groupBy(tx.accountId, tx.cashDate),
      db
        .select()
        .from(creditCardBill)
        .where(
          and(
            inArray(creditCardBill.accountId, cardIds),
            gte(creditCardBill.dueDate, addDays(today, -5)),
          ),
        ),
    ]);
    const closed = new Map<string, number>();
    for (const b of bills) {
      if (!b.closingDate || b.closingDate > today) continue;
      const due = cashDateForDue(b.dueDate as LocalDate, bankingCalendar);
      if (due < today) continue;
      closed.set(`${b.accountId}|${due}`, Math.max(0, b.totalCents - b.paidCents));
    }
    const seen = new Set<string>();
    for (const p of posted) {
      const key = `${p.accountId}|${p.cashDate}`;
      seen.add(key);
      const owed = closed.get(key) ?? Math.max(0, -Number(p.cents));
      if (owed > 0)
        events.push({
          date: p.cashDate as LocalDate,
          cents: -owed,
          label: `Fatura ${accounts.get(p.accountId)?.name ?? 'do cartão'}`,
          kind: 'bill',
          accountId: p.accountId,
        });
    }
    for (const [key, owed] of closed) {
      if (seen.has(key) || owed <= 0) continue;
      const [accountId, date] = key.split('|') as [string, LocalDate];
      events.push({
        date,
        cents: -owed,
        label: `Fatura ${accounts.get(accountId)?.name ?? 'do cartão'}`,
        kind: 'bill',
        accountId,
      });
    }
  }

  // 3) Gasto variável: média mensal do que não é recorrente nem parcela.
  const mode = settings.forecastVariableMode;
  const months = mode === 'avg6' ? 6 : 3;
  const lastFull = addMonths(startOfMonth(today), -1);
  const first = addMonths(lastFull, -(months - 1));
  const confirmedNorms = (
    await db
      .select({ norm: recurringItem.descriptionNorm })
      .from(recurringItem)
      .where(and(eq(recurringItem.status, 'confirmed'), isNotNull(recurringItem.descriptionNorm)))
  ).map((r) => r.norm!);
  const variableRows = await db
    .select({
      month: sql<string>`to_char(${tx.competenceDate}, 'YYYY-MM')`,
      accountId: tx.accountId,
      cents: sql<number>`-sum(${tx.amountCents})::bigint`,
    })
    .from(tx)
    .where(
      and(
        isNull(tx.deletedAt),
        inArray(tx.kind, ['expense', 'refund']),
        gte(tx.competenceDate, first),
        lte(tx.competenceDate, endOfMonth(lastFull)),
        or(isNull(tx.installmentTotal), lte(tx.installmentTotal, 1)),
        confirmedNorms.length ? notInArray(tx.descriptionNorm, confirmedNorms) : undefined,
        sql`not exists (select 1 from ${forecastMatch} m where m.transaction_id = "transaction"."id" and m.unmatched_at is null)`,
      ),
    )
    .groupBy(sql`1`, tx.accountId);
  const perMonth = new Map<string, number>();
  const cardMonthly = new Map<string, number>();
  let bankMonthly = 0;
  for (const r of variableRows) {
    const c = Number(r.cents);
    perMonth.set(r.month, (perMonth.get(r.month) ?? 0) + c);
    if (accounts.get(r.accountId)?.kind === 'credit_card')
      cardMonthly.set(r.accountId, (cardMonthly.get(r.accountId) ?? 0) + c / months);
    else bankMonthly += c / months;
  }
  let variableMonthly = bankMonthly + [...cardMonthly.values()].reduce((a, b) => a + b, 0);
  let variableSource: ProjectionContext['variableSource'] = mode;
  if (mode === 'budget') {
    const [b] = await db
      .select({ total: sql<number>`coalesce(sum(${budget.amountCents}), 0)::bigint` })
      .from(budget)
      .where(eq(budget.month, startOfMonth(today)));
    const total = Number(b?.total ?? 0);
    if (total > 0 && variableMonthly > 0) {
      const k = total / variableMonthly;
      bankMonthly *= k;
      for (const [id, v] of cardMonthly) cardMonthly.set(id, v * k);
      variableMonthly = total;
    } else if (total > 0) {
      bankMonthly = total;
      variableMonthly = total;
    } else variableSource = 'avg3';
  }
  const sigma = stdev([...perMonth.values()]);
  // Variável no cartão: cada dia de gasto cai na fatura do ciclo daquele dia.
  const cardDue = new Map<string, number>();
  for (const c of cards) {
    const monthly = cardMonthly.get(c.id) ?? 0;
    if (!monthly || !c.cycle) {
      bankMonthly += monthly; // sem ciclo conhecido, trata como saída no dia
      continue;
    }
    for (let i = 1; i <= days; i++) {
      const due = cashDateForDue(
        cycleForPurchase(addDays(today, i), c.cycle).dueDate,
        bankingCalendar,
      );
      if (due > end) continue;
      cardDue.set(due, (cardDue.get(due) ?? 0) + monthly / 30);
    }
  }
  return {
    input: {
      start: today,
      startBalance,
      days,
      events,
      variable: {
        dailyCents: bankMonthly / 30,
        monthlySigmaCents: Math.round(sigma),
        cardDue: [...cardDue.entries()].map(([date, cents]) => ({
          date: date as LocalDate,
          cents: Math.round(cents),
        })),
      },
    },
    accounts,
    nextIncome,
    variableMonthlyCents: Math.round(variableMonthly),
    variableSource,
    reserveCents: settings.reserveMinCents,
    cashAccounts: cash.map((a) => ({ id: a.id, name: a.name, balanceCents: a.balanceCents })),
  };
}
