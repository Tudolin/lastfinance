import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatBRL, toCents } from './money';

describe('money', () => {
  it('converte reais para centavos sem erro de ponto flutuante', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1234.565)).toBe(123457);
    expect(toCents(-58.9)).toBe(-5890);
    expect(Object.is(toCents(-0), 0)).toBe(true);
  });

  it('é exato para qualquer valor com 2 casas', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e11, max: 1e11 }), (cents) => {
        expect(toCents(cents / 100)).toBe(cents);
      }),
    );
  });

  it('formata em R$ no padrão brasileiro', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(-5890)).toBe('-R$ 58,90');
    expect(formatBRL(5890, { signed: true })).toBe('+R$ 58,90');
  });

  it('rejeita valores não finitos', () => {
    expect(() => toCents(Number.NaN)).toThrow();
  });
});
