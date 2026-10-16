import { diffDays, type LocalDate } from '../dates/local-date';
import type { Cents } from '../money';
import { tokenSimilarity } from '../text/normalize';
import {
  cardPaymentTextStrength,
  looksLikeCardPaymentOnCard,
  looksLikeInvestmentIn,
  looksLikeInvestmentOut,
  looksLikeRefund,
  looksLikeTransfer,
} from './patterns';
import type {
  AccountKind,
  ClassifiableBill,
  ClassifiableTx,
  Classification,
  ClassifyInput,
  TxKind,
} from './types';

/** Parâmetros das heurísticas (exportados para teste e futura configuração). */
export const CLASSIFY_PARAMS = {
  transferMaxBusinessDays: 2,
  transferMaxCalendarDays: 4,
  transferMinScore: 0.5,
  cardPaymentMinScore: 0.6,
  /** Janela, relativa ao vencimento, em que o pagamento de uma fatura é procurado. */
  billWindowBeforeDue: 15,
  billWindowAfterDue: 7,
  cardPaymentLinkMaxDays: 5,
  refundLookbackDays: 180,
} as const;

type Draft = Omit<Classification, 'linkedTransactionId' | 'paidBillId' | 'refundOfTransactionId'> &
  Partial<Pick<Classification, 'linkedTransactionId' | 'paidBillId' | 'refundOfTransactionId'>>;

function finalize(d: Draft): Classification {
  return {
    linkedTransactionId: null,
    paidBillId: null,
    refundOfTransactionId: null,
    ...d,
    confidence: Math.round(Math.min(1, Math.max(0, d.confidence)) * 100) / 100,
  };
}

const byIdAsc = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Classifica cada transação em um `TxKind`, ligando pares de transferência,
 * pagamentos de fatura (conta ↔ cartão) e estornos às compras originais.
 *
 * Determinística: a mesma entrada sempre produz a mesma saída, independentemente da ordem.
 * Precedência: decisão do usuário > regra > heurística automática.
 */
export function classifyTransactions(input: ClassifyInput): Map<string, Classification> {
  const { calendar, ownDocHashes } = input;
  const accountKind = new Map<string, AccountKind>(input.accounts.map((a) => [a.id, a.kind]));
  const txs = [...input.transactions].sort(byIdAsc);
  const result = new Map<string, Classification>();
  const linked = new Set<string>();

  const isCard = (t: ClassifiableTx) => accountKind.get(t.accountId) === 'credit_card';
  const isBank = (t: ClassifiableTx) => {
    const k = accountKind.get(t.accountId);
    return k === 'checking' || k === 'savings';
  };
  const hasCards = input.accounts.some((a) => a.kind === 'credit_card');

  // 1) Decisões explícitas (usuário, depois regra). Transferências manuais ainda podem ganhar par.
  for (const t of txs) {
    if (t.userKind) {
      result.set(t.id, finalize({ kind: t.userKind, source: 'user', confidence: 1, reason: 'definido pelo usuário' }));
    } else if (t.ruleKind) {
      result.set(t.id, finalize({ kind: t.ruleKind, source: 'rule', confidence: 0.95, reason: 'regra de categorização' }));
    }
  }
  const free = (t: ClassifiableTx) => !result.has(t.id);

  // 2) Lado do cartão: compras são despesas; créditos são pagamento de fatura ou estorno.
  for (const t of txs) {
    if (!free(t) || !isCard(t)) continue;
    if (t.amountCents <= 0) {
      result.set(t.id, finalize({ kind: 'expense', source: 'auto', confidence: 0.95, reason: 'compra no cartão' }));
    } else if (looksLikeCardPaymentOnCard(t.description)) {
      result.set(t.id, finalize({ kind: 'card_payment', source: 'auto', confidence: 0.9, reason: 'crédito de pagamento na fatura' }));
    } else {
      result.set(
        t.id,
        finalize({
          kind: 'refund',
          source: 'auto',
          confidence: looksLikeRefund(t.description) ? 0.85 : 0.65,
          reason: 'crédito no cartão (estorno)',
        }),
      );
    }
  }

  // 3) Lado da conta: pagamento de fatura.
  if (hasCards) {
    for (const t of txs) {
      if (!free(t) || !isBank(t) || t.amountCents >= 0) continue;
      const strength = cardPaymentTextStrength(t.description);
      const bill = bestBillMatch(t, input.bills);
      const score = (strength === 2 ? 0.65 : strength === 1 ? 0.3 : 0) + (bill ? 0.5 : 0);
      if (score >= CLASSIFY_PARAMS.cardPaymentMinScore) {
        result.set(
          t.id,
          finalize({
            kind: 'card_payment',
            source: 'auto',
            confidence: Math.min(0.99, score),
            paidBillId: bill?.id ?? null,
            reason: bill ? 'valor e data batem com uma fatura' : 'descrição de pagamento de fatura',
          }),
        );
      }
    }
  }

  // 4) Aplicações e resgates (caixinhas, CDB, RDB).
  for (const t of txs) {
    if (!free(t) || !isBank(t)) continue;
    if (t.amountCents < 0 && looksLikeInvestmentIn(t.description)) {
      result.set(t.id, finalize({ kind: 'investment_in', source: 'auto', confidence: 0.9, reason: 'aplicação em investimento' }));
    } else if (t.amountCents > 0 && looksLikeInvestmentOut(t.description)) {
      result.set(t.id, finalize({ kind: 'investment_out', source: 'auto', confidence: 0.9, reason: 'resgate de investimento' }));
    }
  }

  // 5) Transferências entre contas próprias (pareamento 1:1 guloso por pontuação).
  const transferEligible = (t: ClassifiableTx) =>
    isBank(t) && (free(t) || result.get(t.id)?.kind === 'internal_transfer');
  const outs = txs.filter((t) => transferEligible(t) && t.amountCents < 0);
  const ins = txs.filter((t) => transferEligible(t) && t.amountCents > 0);
  const insByAmount = new Map<Cents, ClassifiableTx[]>();
  for (const i of ins) {
    const list = insByAmount.get(i.amountCents) ?? [];
    list.push(i);
    insByAmount.set(i.amountCents, list);
  }

  type Cand = { out: ClassifiableTx; in: ClassifiableTx; score: number; gap: number };
  const cands: Cand[] = [];
  for (const o of outs) {
    for (const i of insByAmount.get(-o.amountCents) ?? []) {
      if (i.accountId === o.accountId) continue;
      const gap = Math.abs(diffDays(i.date, o.date));
      if (gap > CLASSIFY_PARAMS.transferMaxCalendarDays) continue;
      const bdays = calendar.businessDaysBetween(o.date, i.date);
      if (bdays > CLASSIFY_PARAMS.transferMaxBusinessDays) continue;
      let score = 0.5 - 0.08 * bdays;
      if (looksLikeTransfer(o.description) || looksLikeTransfer(i.description)) score += 0.25;
      const ownSides = Number(isOwnDoc(o, ownDocHashes)) + Number(isOwnDoc(i, ownDocHashes));
      if (ownSides > 0) score += 0.35 + (ownSides === 2 ? 0.1 : 0);
      if (result.get(o.id)?.source === 'user' || result.get(i.id)?.source === 'user') score += 0.5;
      if (score >= CLASSIFY_PARAMS.transferMinScore) cands.push({ out: o, in: i, score, gap });
    }
  }
  cands.sort(
    (a, b) =>
      b.score - a.score ||
      a.gap - b.gap ||
      (a.out.id < b.out.id ? -1 : a.out.id > b.out.id ? 1 : 0) ||
      (a.in.id < b.in.id ? -1 : a.in.id > b.in.id ? 1 : 0),
  );
  for (const c of cands) {
    if (linked.has(c.out.id) || linked.has(c.in.id)) continue;
    linked.add(c.out.id);
    linked.add(c.in.id);
    for (const [me, other] of [
      [c.out, c.in],
      [c.in, c.out],
    ] as const) {
      const prev = result.get(me.id);
      result.set(
        me.id,
        finalize({
          kind: 'internal_transfer',
          source: prev?.source ?? 'auto',
          confidence: prev?.source === 'user' ? 1 : Math.min(0.99, c.score),
          linkedTransactionId: other.id,
          reason: 'mesmo valor, sinais opostos, contas próprias, datas próximas',
        }),
      );
    }
  }

  // 6) Transferência para conta própria não conectada (documento da contraparte = o meu).
  for (const t of txs) {
    if (!free(t) || !isBank(t)) continue;
    if (isOwnDoc(t, ownDocHashes)) {
      result.set(
        t.id,
        finalize({ kind: 'internal_transfer', source: 'auto', confidence: 0.75, reason: 'contraparte é o próprio titular' }),
      );
    }
  }

  // 7) O que sobrou na conta: receita, despesa ou estorno.
  for (const t of txs) {
    if (!free(t)) continue;
    if (t.amountCents > 0) {
      const refund = looksLikeRefund(t.description);
      result.set(
        t.id,
        finalize({
          kind: refund ? 'refund' : 'income',
          source: 'auto',
          confidence: refund ? 0.8 : 0.7,
          reason: refund ? 'crédito de estorno/devolução' : 'entrada na conta',
        }),
      );
    } else {
      result.set(t.id, finalize({ kind: 'expense', source: 'auto', confidence: 0.8, reason: 'saída da conta' }));
    }
  }

  linkCardPayments(txs, result, accountKind);
  linkRefunds(txs, result);
  return result;
}

function isOwnDoc(t: ClassifiableTx, own: ReadonlySet<string>): boolean {
  return !!t.counterpartyDocHash && own.has(t.counterpartyDocHash);
}

/** Fatura cujo total, mínimo ou algum pagamento registrado bate com o débito, perto do vencimento. */
export function bestBillMatch(t: ClassifiableTx, bills: readonly ClassifiableBill[]): ClassifiableBill | null {
  const paid = -t.amountCents;
  let best: { bill: ClassifiableBill; gap: number } | null = null;
  for (const b of bills) {
    const offset = diffDays(t.date, b.dueDate);
    if (offset < -CLASSIFY_PARAMS.billWindowBeforeDue || offset > CLASSIFY_PARAMS.billWindowAfterDue) continue;
    const amounts = [b.totalCents, b.minimumCents, ...b.paymentsCents].filter((v): v is number => v != null && v > 0);
    if (!amounts.includes(paid)) continue;
    const gap = Math.abs(offset);
    if (!best || gap < best.gap || (gap === best.gap && b.id < best.bill.id)) best = { bill: b, gap };
  }
  return best?.bill ?? null;
}

/** Liga o débito na conta ao crédito "pagamento recebido" no cartão (mesmo valor, datas próximas). */
function linkCardPayments(
  txs: readonly ClassifiableTx[],
  result: Map<string, Classification>,
  accountKind: Map<string, AccountKind>,
) {
  const kindOf = (t: ClassifiableTx) => result.get(t.id)?.kind;
  const bankSide = txs.filter((t) => kindOf(t) === 'card_payment' && accountKind.get(t.accountId) !== 'credit_card');
  const cardSide = txs.filter((t) => kindOf(t) === 'card_payment' && accountKind.get(t.accountId) === 'credit_card');
  const used = new Set<string>();
  const pairs: { bank: ClassifiableTx; card: ClassifiableTx; gap: number }[] = [];
  for (const b of bankSide) {
    for (const c of cardSide) {
      if (c.amountCents !== -b.amountCents) continue;
      const gap = Math.abs(diffDays(b.date, c.date));
      if (gap <= CLASSIFY_PARAMS.cardPaymentLinkMaxDays) pairs.push({ bank: b, card: c, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || (a.bank.id < b.bank.id ? -1 : 1) || (a.card.id < b.card.id ? -1 : 1));
  for (const p of pairs) {
    if (used.has(p.bank.id) || used.has(p.card.id)) continue;
    used.add(p.bank.id);
    used.add(p.card.id);
    result.set(p.bank.id, { ...result.get(p.bank.id)!, linkedTransactionId: p.card.id });
    result.set(p.card.id, { ...result.get(p.card.id)!, linkedTransactionId: p.bank.id });
  }
}

const REFUND_WORDS = /\b(ESTORNO|DEVOLUCAO|REEMBOLSO|CHARGEBACK|CANCELAMENTO|CREDITO DE COMPRA)\b/g;

/** Para cada estorno, procura a compra original: mesma conta, antes do estorno, valor ≥, descrição parecida. */
function linkRefunds(txs: readonly ClassifiableTx[], result: Map<string, Classification>) {
  const expenses = txs.filter((t) => result.get(t.id)?.kind === 'expense');
  for (const r of txs) {
    const cls = result.get(r.id);
    if (cls?.kind !== 'refund' || cls.refundOfTransactionId) continue;
    const cleaned = r.description.toUpperCase().replace(REFUND_WORDS, ' ');
    let best: { t: ClassifiableTx; score: number } | null = null;
    for (const e of expenses) {
      if (e.accountId !== r.accountId) continue;
      const age = diffDays(r.date as LocalDate, e.date);
      if (age < 0 || age > CLASSIFY_PARAMS.refundLookbackDays) continue;
      if (-e.amountCents < r.amountCents) continue;
      const sim = tokenSimilarity(cleaned, e.description);
      const exact = -e.amountCents === r.amountCents;
      if (sim < (exact ? 0.2 : 0.34)) continue;
      const score = sim + (exact ? 0.5 : 0) - age / 1000;
      if (!best || score > best.score || (score === best.score && e.id < best.t.id)) best = { t: e, score };
    }
    if (best) result.set(r.id, { ...cls, refundOfTransactionId: best.t.id });
  }
}

/** Utilitário para testes e relatórios: kinds que contam como despesa/receita. */
export function isSpending(kind: TxKind): boolean {
  return kind === 'expense' || kind === 'refund';
}
