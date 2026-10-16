import { describe, expect, it } from 'vitest';
import { pluggyTransactionSchema } from '@/server/adapters/pluggy/types';
import { mapTransaction, pluggyDateToLocal } from './pluggy-mapping';

describe('pluggyDateToLocal', () => {
  it('meia-noite UTC é data pura', () => {
    expect(pluggyDateToLocal(new Date('2026-03-10T00:00:00.000Z'))).toBe('2026-03-10');
  });

  it('meia-noite UTC com milissegundos (Nubank) também é data pura', () => {
    expect(pluggyDateToLocal(new Date('2026-03-10T00:00:00.001Z'))).toBe('2026-03-10');
  });

  it('instante com hora vira o dia em São Paulo', () => {
    expect(pluggyDateToLocal(new Date('2026-03-10T02:04:28.094Z'))).toBe('2026-03-09');
    expect(pluggyDateToLocal(new Date('2026-03-10T03:00:00.000Z'))).toBe('2026-03-10');
    expect(pluggyDateToLocal(new Date('2026-03-10T00:00:01.000Z'))).toBe('2026-03-09');
  });
});

describe('mapTransaction no cartão', () => {
  const card = { id: 'acc-1', kind: 'credit_card' as const };
  const parse = (o: Record<string, unknown>) =>
    pluggyTransactionSchema.parse({
      id: 't1',
      accountId: 'p-acc',
      description: 'LOJA X',
      descriptionRaw: null,
      currencyCode: 'BRL',
      providerCode: null,
      providerId: null,
      operationType: null,
      ...o,
    });

  it('parcela usa a data da transação como competência, não a da compra original', () => {
    const m = mapTransaction(
      parse({
        date: '2026-05-12T00:00:00.000Z',
        type: 'DEBIT',
        amount: 100,
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 10,
          purchaseDate: '2026-03-12T00:00:00.000Z',
          billId: 'b1',
        },
      }),
      card,
    );
    expect(m.competenceDate).toBe('2026-05-12');
    expect(m.installmentNumber).toBe(3);
    expect(m.installmentTotal).toBe(10);
    expect(m.amountCents).toBe(-10000);
  });

  it('crédito negativo no cartão (pagamento/estorno) vira entrada', () => {
    const m = mapTransaction(
      parse({ date: '2026-05-12T00:00:00.001Z', type: 'CREDIT', amount: -55.5 }),
      card,
    );
    expect(m.amountCents).toBe(5550);
    expect(m.date).toBe('2026-05-12');
  });
});
