import type { BusinessCalendar } from '../dates/business-days';
import type { LocalDate } from '../dates/local-date';
import type { Cents } from '../money';

export const TX_KINDS = [
  'expense',
  'income',
  'internal_transfer',
  'investment_in',
  'investment_out',
  'card_payment',
  'refund',
  'adjustment',
] as const;
export type TxKind = (typeof TX_KINDS)[number];

export const TX_KIND_LABEL: Record<TxKind, string> = {
  expense: 'Despesa',
  income: 'Receita',
  internal_transfer: 'Transferência entre contas',
  investment_in: 'Aplicação',
  investment_out: 'Resgate',
  card_payment: 'Pagamento de fatura',
  refund: 'Estorno',
  adjustment: 'Ajuste (neutro)',
};

export type AccountKind = 'checking' | 'savings' | 'credit_card';

export type ClassifiableAccount = { id: string; kind: AccountKind };

/**
 * Convenção de sinal: `amountCents` > 0 é entrada (na conta: crédito; no cartão: pagamento/estorno),
 * `amountCents` < 0 é saída (na conta: débito; no cartão: compra).
 */
export type ClassifiableTx = {
  id: string;
  accountId: string;
  date: LocalDate;
  amountCents: Cents;
  description: string;
  /** Hash do CPF/CNPJ da contraparte (recebedor na saída, pagador na entrada), quando a Pluggy informa. */
  counterpartyDocHash?: string | null;
  userKind?: TxKind | null;
  ruleKind?: TxKind | null;
};

export type ClassifiableBill = {
  id: string;
  accountId: string;
  dueDate: LocalDate;
  totalCents: Cents;
  minimumCents: Cents | null;
  paymentsCents: readonly Cents[];
};

export type KindSource = 'user' | 'rule' | 'auto';

export type Classification = {
  kind: TxKind;
  source: KindSource;
  /** 0..1 — abaixo de ~0,7 a transação deve ir para revisão. */
  confidence: number;
  /** Par da transferência interna ou a outra ponta do pagamento de fatura. */
  linkedTransactionId: string | null;
  /** Fatura paga (para card_payment no lado da conta). */
  paidBillId: string | null;
  /** Compra original estornada. */
  refundOfTransactionId: string | null;
  reason: string;
};

export type ClassifyInput = {
  accounts: readonly ClassifiableAccount[];
  transactions: readonly ClassifiableTx[];
  bills: readonly ClassifiableBill[];
  ownDocHashes: ReadonlySet<string>;
  calendar: BusinessCalendar;
};

/** Efeito de cada kind nas agregações. */
export const KIND_EFFECT: Record<TxKind, { expense: boolean; income: boolean; invested: boolean }> = {
  expense: { expense: true, income: false, invested: false },
  income: { expense: false, income: true, invested: false },
  internal_transfer: { expense: false, income: false, invested: false },
  investment_in: { expense: false, income: false, invested: true },
  investment_out: { expense: false, income: false, invested: true },
  card_payment: { expense: false, income: false, invested: false },
  // O estorno abate despesa (entra com sinal positivo na categoria original).
  refund: { expense: true, income: false, invested: false },
  adjustment: { expense: false, income: false, invested: false },
};
