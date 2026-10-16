import { describe, expect, it } from 'vitest';
import { localDate as d } from '../dates/local-date';
import { futureCommitment, installmentsByMonth, projectFutureInstallments } from './installments';

const base = {
  accountId: 'itau',
  baseDescription: 'NOTEBOOK DELL',
  amountCents: -41250,
  installmentTotal: 10,
};

describe('parcelas futuras', () => {
  it('gera as parcelas restantes a partir da maior vista', () => {
    const r = projectFutureInstallments([
      { ...base, installmentNumber: 2, dueDate: d('2026-10-05') },
      { ...base, installmentNumber: 3, dueDate: d('2026-11-05') },
    ]);
    expect(r).toHaveLength(7);
    expect(r[0]).toMatchObject({ number: 4, dueDate: '2026-12-05', amountCents: 41250 });
    expect(r.at(-1)).toMatchObject({ number: 10, dueDate: '2027-06-05' });
  });

  it('última parcela já vista: nada a projetar', () => {
    expect(
      projectFutureInstallments([{ ...base, installmentNumber: 10, dueDate: d('2026-10-05') }]),
    ).toEqual([]);
  });

  it('duas compras iguais em contas diferentes não se misturam', () => {
    const r = projectFutureInstallments([
      { ...base, installmentNumber: 9, dueDate: d('2026-10-05') },
      { ...base, accountId: 'nu', installmentNumber: 8, dueDate: d('2026-10-10') },
    ]);
    expect(r.map((x) => `${x.accountId}:${x.number}`)).toEqual(['itau:10', 'nu:9', 'nu:10']);
  });

  it('usa o dia de vencimento do cartão (31 em mês curto vira o último dia)', () => {
    const r = projectFutureInstallments(
      [{ ...base, installmentNumber: 1, installmentTotal: 2, dueDate: d('2027-01-31') }],
      new Map([['itau', 31]]),
    );
    expect(r[0]!.dueDate).toBe('2027-02-28');
  });

  it('agrega por mês e calcula o comprometimento da renda', () => {
    const items = projectFutureInstallments([
      { ...base, installmentNumber: 8, dueDate: d('2026-10-05') },
      {
        ...base,
        baseDescription: 'GELADEIRA',
        amountCents: -30000,
        installmentNumber: 1,
        installmentTotal: 3,
        dueDate: d('2026-10-05'),
      },
    ]);
    expect(installmentsByMonth(items).get('2026-11')).toBe(71250);
    expect(futureCommitment(items, 712500)[0]).toEqual({
      month: '2026-11',
      cents: 71250,
      ratio: 0.1,
    });
  });
});
