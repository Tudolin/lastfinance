import { describe, expect, it } from 'vitest';
import { localDate as d } from '../dates/local-date';
import { signedAmountCents, transactionFingerprint } from './normalize';

describe('sinal do valor', () => {
  it('conta: tipo manda, independentemente do sinal da Pluggy', () => {
    expect(signedAmountCents('checking', 'DEBIT', -58.9)).toBe(-5890);
    expect(signedAmountCents('checking', 'DEBIT', 58.9)).toBe(-5890);
    expect(signedAmountCents('savings', 'CREDIT', 100)).toBe(10000);
  });

  it('cartão: positivo na Pluggy é compra (saída), negativo é pagamento/crédito (entrada)', () => {
    expect(signedAmountCents('credit_card', 'DEBIT', 23.4)).toBe(-2340);
    expect(signedAmountCents('credit_card', 'CREDIT', -2318.44)).toBe(231844);
    expect(signedAmountCents('credit_card', 'DEBIT', 0)).toBe(0);
  });
});

describe('impressão digital', () => {
  it('ignora ruído da descrição', () => {
    expect(transactionFingerprint('a', d('2026-10-01'), -100, 'PG *LOJA 08:31')).toBe(
      transactionFingerprint('a', d('2026-10-01'), -100, 'loja'),
    );
  });
});
