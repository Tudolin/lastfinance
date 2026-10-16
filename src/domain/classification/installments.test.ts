import { describe, expect, it } from 'vitest';
import { parseInstallmentFromDescription as parse, resolveInstallment } from './installments';

describe('parcelas', () => {
  it.each([
    ['NETSHOES 03/10', { number: 3, total: 10 }],
    ['Notebook Dell 3/10', { number: 3, total: 10 }],
    ['LOJA X PARC 03/12', { number: 3, total: 12 }],
    ['Loja Y - Parcela 2 de 6', { number: 2, total: 6 }],
    ['Magazine 1 DE 3', { number: 1, total: 3 }],
    ['PARC.10/10 CASAS BAHIA', { number: 10, total: 10 }],
  ])('%s', (desc, expected) => {
    expect(parse(desc)).toEqual(expected);
  });

  it.each([
    'UBER 12/03', // data: 12 > 3
    'PADARIA',
    'COMPRA 31/12/2026',
    'Item 1/1', // à vista
    'Estranho 0/5',
    'X 3/99', // total acima do limite
  ])('não confunde: %s', (desc) => {
    expect(parse(desc)).toBeNull();
  });

  it('prefere o metadado da Pluggy', () => {
    expect(resolveInstallment({ installmentNumber: 4, totalInstallments: 5 }, 'LOJA 1/2')).toEqual({ number: 4, total: 5 });
    expect(resolveInstallment({ installmentNumber: null, totalInstallments: null }, 'LOJA 1/2')).toEqual({ number: 1, total: 2 });
    expect(resolveInstallment(null, 'LOJA')).toBeNull();
  });
});
