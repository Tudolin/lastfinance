import type { AccountKind } from '../classification/types';
import type { LocalDate } from '../dates/local-date';
import { toCents, type Cents } from '../money';
import { normalizeDescription } from '../text/normalize';

/**
 * Converte o valor da Pluggy para a convenção do app (+ entrada / − saída):
 * - Conta: o tipo manda (CREDIT = entrada, DEBIT = saída).
 * - Cartão: na Pluggy, valor positivo é compra e negativo é pagamento/crédito; invertemos.
 */
export function signedAmountCents(accountKind: AccountKind, type: 'DEBIT' | 'CREDIT', amount: number): Cents {
  const abs = Math.abs(toCents(amount));
  if (accountKind === 'credit_card') {
    if (amount === 0) return 0;
    return amount > 0 ? -abs : abs;
  }
  return type === 'CREDIT' ? abs : -abs;
}

/**
 * Impressão digital para reconhecer a "mesma" transação quando a Pluggy troca o id
 * (mudança grande de data/valor/descrição ou item reconectado).
 */
export function transactionFingerprint(accountId: string, date: LocalDate, amountCents: Cents, description: string): string {
  return `${accountId}|${date}|${amountCents}|${normalizeDescription(description)}`;
}

/** Regime de competência: a data da compra. Regime de caixa: quando o dinheiro sai. */
export type Basis = 'cash' | 'accrual';
