import { diffDays, formatBR, type LocalDate } from '../dates/local-date';
import { formatBRL, type Cents } from '../money';
import { plannedDrafts, type AccountRef } from './drafts';
import { project, type CashEvent, type Projection, type ProjectionInput } from './project';

export type PurchaseInput = {
  amountCents: Cents;
  method: 'pix' | 'debit' | 'credit';
  installments: number;
  date: LocalDate;
  /** Cartão usado (crédito) ou conta (pix/débito). */
  account: AccountRef | null;
  description?: string;
};

export type Verdict = 'ok' | 'warn' | 'no';

export type CanSpendResult = {
  verdict: Verdict;
  reasons: string[];
  purchaseEvents: CashEvent[];
  before: Projection;
  after: Projection;
  afterConservative: Projection;
};

/** Movimentos de caixa de uma compra: Pix/débito saem no dia; crédito sai em cada fatura. */
export function purchaseEvents(p: PurchaseInput): CashEvent[] {
  return plannedDrafts({
    id: 'simulacao',
    description: p.description ?? 'Compra simulada',
    amountCents: p.amountCents,
    date: p.date,
    account: p.account,
    paymentMethod: p.method,
    installments: p.installments,
    categoryId: null,
  }).map((d) => ({
    date: d.cashDate,
    cents: -d.expectedCents,
    label: d.label,
    kind: 'purchase',
    accountId: d.accountId,
  }));
}

/**
 * "Posso gastar?": roda a mesma projeção com e sem a compra.
 * ❌ se o saldo previsto fica negativo; ⚠️ se fura a reserva mínima ou se fica negativo no
 * cenário conservador; ✅ caso contrário.
 */
export function canSpend(
  base: ProjectionInput,
  purchase: PurchaseInput,
  reserveCents: Cents,
): CanSpendResult {
  const extra = purchaseEvents(purchase);
  const lastCash = extra.reduce((m, e) => (e.date > m ? e.date : m), base.start);
  const days = Math.max(base.days, diffDays(lastCash, base.start) + 15);
  const input = { ...base, days };
  const before = project(input);
  const withPurchase = { ...input, events: [...base.events, ...extra] };
  const after = project(withPurchase);
  const afterConservative = project({ ...withPurchase, scenario: 'conservative' });

  const reasons: string[] = [];
  let verdict: Verdict = 'ok';
  const minTxt = `${formatBRL(after.min.balance)} em ${formatBR(after.min.date)}`;
  if (after.min.balance < 0) {
    verdict = 'no';
    reasons.push(`O saldo previsto fica negativo: o menor saldo seria ${minTxt}.`);
    if (after.firstNegative)
      reasons.push(`Fica negativo a partir de ${formatBR(after.firstNegative)}.`);
  } else if (after.min.balance < reserveCents) {
    verdict = 'warn';
    reasons.push(
      `O menor saldo previsto (${minTxt}) fica abaixo da sua reserva mínima de ${formatBRL(reserveCents)}.`,
    );
  } else if (afterConservative.min.balance < 0) {
    verdict = 'warn';
    reasons.push(
      `Cabe no cenário esperado (menor saldo ${minTxt}), mas fica negativo no cenário conservador (${formatBRL(afterConservative.min.balance)}).`,
    );
  } else {
    reasons.push(
      `Cabe: o menor saldo previsto passa a ser ${minTxt}, acima da reserva de ${formatBRL(reserveCents)}.`,
    );
  }
  const delta = before.min.balance - after.min.balance;
  if (delta > 0) reasons.push(`A compra reduz o menor saldo do período em ${formatBRL(delta)}.`);
  if (purchase.method === 'credit')
    reasons.push(
      `No crédito, ${extra.length > 1 ? `as ${extra.length} parcelas saem` : 'o valor sai'} nas faturas: ${extra.map((e) => formatBR(e.date)).join(', ')}.`,
    );
  return { verdict, reasons, purchaseEvents: extra, before, after, afterConservative };
}
