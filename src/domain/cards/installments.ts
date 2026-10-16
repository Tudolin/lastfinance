import { addMonths, clampedDate, parts, type LocalDate } from '../dates/local-date';
import type { Cents } from '../money';

export type InstallmentTx = {
  accountId: string;
  /** descrição sem o marcador de parcela (ex.: "NOTEBOOK DELL") */
  baseDescription: string;
  amountCents: Cents; // negativo (compra)
  installmentNumber: number;
  installmentTotal: number;
  /** vencimento da fatura em que esta parcela caiu (ou cairá) */
  dueDate: LocalDate;
};

export type FutureInstallment = {
  accountId: string;
  description: string;
  number: number;
  total: number;
  amountCents: Cents; // positivo: valor a pagar
  dueDate: LocalDate;
};

/**
 * Projeta as parcelas que ainda vão cair nas próximas faturas.
 * Agrupa as parcelas já vistas por (conta, descrição, total, valor) — a mesma compra parcelada —
 * e, a partir da maior parcela observada, gera as restantes mês a mês no dia de vencimento do cartão.
 */
export function projectFutureInstallments(
  txs: readonly InstallmentTx[],
  dueDayByAccount: ReadonlyMap<string, number> = new Map(),
): FutureInstallment[] {
  const groups = new Map<string, InstallmentTx>();
  for (const t of txs) {
    if (
      t.installmentTotal < 2 ||
      t.installmentNumber < 1 ||
      t.installmentNumber > t.installmentTotal
    )
      continue;
    const key = `${t.accountId}|${t.baseDescription}|${t.installmentTotal}|${Math.abs(t.amountCents)}`;
    const cur = groups.get(key);
    if (!cur || t.installmentNumber > cur.installmentNumber) groups.set(key, t);
  }
  const out: FutureInstallment[] = [];
  for (const g of groups.values()) {
    const dueDay = dueDayByAccount.get(g.accountId) ?? parts(g.dueDate).day;
    for (let k = g.installmentNumber + 1; k <= g.installmentTotal; k++) {
      const shifted = addMonths(g.dueDate, k - g.installmentNumber);
      const { year, month } = parts(shifted);
      out.push({
        accountId: g.accountId,
        description: g.baseDescription,
        number: k,
        total: g.installmentTotal,
        amountCents: Math.abs(g.amountCents),
        dueDate: clampedDate(year, month, dueDay),
      });
    }
  }
  return out.sort((a, b) =>
    a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.description < b.description ? -1 : 1,
  );
}

/** Soma das parcelas futuras por mês de vencimento ('YYYY-MM'). */
export function installmentsByMonth(items: readonly FutureInstallment[]): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const i of items) {
    const key = i.dueDate.slice(0, 7);
    m.set(key, (m.get(key) ?? 0) + i.amountCents);
  }
  return m;
}

/** Fração da renda mensal já comprometida com parcelas em cada mês futuro. */
export function futureCommitment(
  items: readonly FutureInstallment[],
  monthlyIncomeCents: Cents,
): { month: string; cents: Cents; ratio: number | null }[] {
  return [...installmentsByMonth(items).entries()].map(([month, cents]) => ({
    month,
    cents,
    ratio: monthlyIncomeCents > 0 ? Math.round((cents / monthlyIncomeCents) * 1000) / 1000 : null,
  }));
}
