import type { BusinessCalendar } from '../dates/business-days';
import { addMonths, clampedDate, parts, type LocalDate } from '../dates/local-date';

export type BillRef = { id: string; closingDate: LocalDate | null; dueDate: LocalDate };
export type CardCycleConfig = { closingDay: number; dueDay: number };
export type Cycle = { closingDate: LocalDate; dueDate: LocalDate };

/**
 * Convenção: uma compra feita NO dia do fechamento já entra na fatura seguinte
 * (é o "melhor dia de compra"). Compra em `d` pertence ao primeiro ciclo cujo fechamento é > d.
 */
export function cycleForPurchase(purchase: LocalDate, cfg: CardCycleConfig): Cycle {
  const { year, month } = parts(purchase);
  let closing = clampedDate(year, month, cfg.closingDay);
  if (purchase >= closing) closing = clampedDate(...nextYm(year, month), cfg.closingDay);
  return { closingDate: closing, dueDate: dueForClosing(closing, cfg) };
}

function nextYm(year: number, month: number): [number, number] {
  return month === 12 ? [year + 1, 1] : [year, month + 1];
}

/** Vencimento correspondente a um fechamento: mesmo mês se dueDay > closingDay, senão mês seguinte. */
export function dueForClosing(closing: LocalDate, cfg: CardCycleConfig): LocalDate {
  const { year, month } = parts(closing);
  if (cfg.dueDay > cfg.closingDay) return clampedDate(year, month, cfg.dueDay);
  return clampedDate(...nextYm(year, month), cfg.dueDay);
}

/** Ciclo `k` meses depois do ciclo dado (para parcelas futuras). */
export function shiftCycle(c: Cycle, months: number, cfg: CardCycleConfig): Cycle {
  const { year, month } = parts(addMonths(c.closingDate, months));
  const closing = clampedDate(year, month, cfg.closingDay);
  return { closingDate: closing, dueDate: dueForClosing(closing, cfg) };
}

/**
 * Atribui uma compra a uma fatura conhecida (com data de fechamento).
 * Retorna null se nenhuma fatura conhecida cobre a data (ex.: fatura ainda não emitida).
 */
export function assignToKnownBill(purchase: LocalDate, bills: readonly BillRef[]): BillRef | null {
  const sorted = bills
    .filter((b): b is BillRef & { closingDate: LocalDate } => b.closingDate != null)
    .sort((a, b) => (a.closingDate < b.closingDate ? -1 : a.closingDate > b.closingDate ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]!;
    const prevClosing = sorted[i - 1]?.closingDate;
    if (purchase < b.closingDate && (!prevClosing || purchase >= prevClosing)) return b;
  }
  return null;
}

/**
 * Deduz dia de fechamento/vencimento a partir de faturas reais (moda dos dias) — usado quando a
 * conta não informa `balanceCloseDate`/`balanceDueDate`.
 */
export function inferCycleConfig(
  bills: readonly { closingDate: LocalDate | null; dueDate: LocalDate }[],
): CardCycleConfig | null {
  const mode = (xs: number[]) => {
    const c = new Map<number, number>();
    for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  };
  const due = mode(bills.map((b) => parts(b.dueDate).day));
  const closing = mode(bills.filter((b) => b.closingDate).map((b) => parts(b.closingDate!).day));
  if (due == null || closing == null) return null;
  return { closingDay: closing, dueDay: due };
}

/** Data em que o dinheiro efetivamente sai: vencimento ajustado para o próximo dia útil. */
export function cashDateForDue(due: LocalDate, calendar: BusinessCalendar): LocalDate {
  return calendar.nextOrSame(due);
}

/**
 * Melhor dia de compra: o próprio dia do fechamento (a compra cai na fatura seguinte,
 * maximizando o prazo até o pagamento).
 */
export function bestPurchaseDay(cfg: CardCycleConfig): number {
  return cfg.closingDay;
}
