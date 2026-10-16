import { cashDateForDue, cycleForPurchase, type CardCycleConfig } from '../cards/billing-cycle';
import type { FutureInstallment } from '../cards/installments';
import { bankingCalendar } from '../dates/business-days';
import {
  addDays,
  addMonths,
  clampedDate,
  dayOfWeek,
  parts,
  startOfMonth,
  type LocalDate,
} from '../dates/local-date';
import type { Cents } from '../money';
import type { Periodicity } from '../recurrence/detect';
import type { Direction, ForecastDraft } from './types';

export type AccountRef = {
  id: string;
  kind: 'checking' | 'savings' | 'credit_card';
  cycle: CardCycleConfig | null;
};

/** Quando o dinheiro sai: na conta, no dia; no cartão, no vencimento da fatura da compra. */
export function cashDateFor(date: LocalDate, account: AccountRef | null): LocalDate {
  if (account?.kind !== 'credit_card') return date;
  if (!account.cycle) return addDays(date, 30);
  return cashDateForDue(cycleForPurchase(date, account.cycle).dueDate, bankingCalendar);
}

export type RecurringDef = {
  id: string;
  name: string;
  direction: Direction;
  account: AccountRef | null;
  categoryId: string | null;
  descriptionNorm: string | null;
  amountCents: Cents;
  tolerancePct: number;
  nature: 'fixed' | 'variable';
  periodicity: Periodicity;
  anchorDay: number;
  anchorMonth: number | null;
  startDate: LocalDate;
  endDate: LocalDate | null;
};

export function recurringDates(def: RecurringDef, from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  const lo = def.startDate > from ? def.startDate : from;
  const hi = def.endDate && def.endDate < to ? def.endDate : to;
  if (lo > hi) return out;
  if (def.periodicity === 'weekly') {
    let d = lo;
    while (dayOfWeek(d) !== def.anchorDay) d = addDays(d, 1);
    for (; d <= hi; d = addDays(d, 7)) out.push(d);
    return out;
  }
  for (let m = startOfMonth(lo); m <= hi; m = addMonths(m, 1)) {
    const { year, month } = parts(m);
    if (def.periodicity === 'yearly' && month !== def.anchorMonth) continue;
    const d = clampedDate(year, month, def.anchorDay);
    if (d >= lo && d <= hi) out.push(d);
  }
  return out;
}

export function recurringDrafts(
  def: RecurringDef,
  from: LocalDate,
  to: LocalDate,
): ForecastDraft[] {
  const spread = def.nature === 'fixed' ? 0 : def.tolerancePct;
  return recurringDates(def, from, to).map((date) => ({
    sourceType: 'recurring',
    sourceId: def.id,
    direction: def.direction,
    accountId: def.account?.id ?? null,
    categoryId: def.categoryId,
    label: def.name,
    expectedDate: date,
    cashDate: cashDateFor(date, def.account),
    windowStart: addDays(date, -5),
    windowEnd: addDays(date, 7),
    expectedCents: def.amountCents,
    lowCents: Math.round(def.amountCents * (1 - spread)),
    highCents: Math.round(def.amountCents * (1 + spread)),
    certainty: def.nature === 'fixed' ? 'certain' : 'estimated',
    tolerancePct: def.tolerancePct,
    matchPattern: def.descriptionNorm,
    breakdown: null,
  }));
}

export type PlannedDef = {
  id: string;
  description: string;
  amountCents: Cents;
  date: LocalDate;
  account: AccountRef | null;
  paymentMethod: 'pix' | 'debit' | 'credit';
  installments: number;
  categoryId: string | null;
};

/** Parcelas de uma compra: o resto dos centavos fica na 1ª parcela (como os cartões fazem). */
export function splitInstallments(total: Cents, n: number): Cents[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? total - base * (n - 1) : base));
}

export function plannedDrafts(def: PlannedDef): ForecastDraft[] {
  const credit = def.paymentMethod === 'credit';
  const n = credit ? Math.max(1, def.installments) : 1;
  const amounts = splitInstallments(def.amountCents, n);
  return amounts.map((cents, k) => {
    const date = addMonths(def.date, k);
    return {
      sourceType: 'planned' as const,
      sourceId: def.id,
      direction: 'out' as const,
      accountId: def.account?.id ?? null,
      categoryId: def.categoryId,
      label: n > 1 ? `${def.description} (${k + 1}/${n})` : def.description,
      expectedDate: date,
      cashDate: credit ? cashDateFor(date, def.account) : date,
      windowStart: addDays(date, -7),
      windowEnd: addDays(date, 7),
      expectedCents: cents,
      lowCents: cents,
      highCents: cents,
      certainty: 'certain' as const,
      tolerancePct: 0.1,
      matchPattern: def.description,
      breakdown: n > 1 ? { installment: k + 1, of: n, total: def.amountCents } : null,
    };
  });
}

/** Parcelas já contratadas no cartão que ainda vão cair (regeneradas a cada sincronização). */
export function installmentDrafts(items: readonly FutureInstallment[]): ForecastDraft[] {
  return items.map((i) => ({
    sourceType: 'installment',
    sourceId: `${i.accountId}|${i.description}|${i.total}|${i.amountCents}`,
    direction: 'out',
    accountId: i.accountId,
    categoryId: null,
    label: `${i.description} (${i.number}/${i.total})`,
    expectedDate: i.dueDate,
    cashDate: cashDateForDue(i.dueDate, bankingCalendar),
    windowStart: addDays(i.dueDate, -40),
    windowEnd: i.dueDate,
    expectedCents: i.amountCents,
    lowCents: i.amountCents,
    highCents: i.amountCents,
    certainty: 'certain',
    tolerancePct: 0,
    matchPattern: i.description,
    breakdown: { number: i.number, total: i.total },
  }));
}
