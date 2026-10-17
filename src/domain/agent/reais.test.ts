import { describe, expect, it } from 'vitest';
import { centsToReais } from './reais';

describe('centsToReais', () => {
  it('troca campos em centavos por reais, inclusive aninhados', () => {
    expect(
      centsToReais({
        balanceCents: 123456,
        name: 'Conta',
        items: [{ cents: -990, label: 'x' }],
        limitCents: null,
        at: new Date('2026-10-01T12:00:00Z'),
      }),
    ).toEqual({
      balance: 1234.56,
      name: 'Conta',
      items: [{ reais: -9.9, label: 'x' }],
      limit: null,
      at: '2026-10-01T12:00:00.000Z',
    });
  });

  it('não mexe em números que não são centavos', () => {
    expect(centsToReais({ count: 3, usedRatio: 0.5 })).toEqual({ count: 3, usedRatio: 0.5 });
  });
});
