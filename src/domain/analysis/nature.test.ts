import { describe, expect, it } from 'vitest';
import { analyzeGroup, monthRange } from './nature';

const months = monthRange('2025-11', '2026-10');
const pts = (values: number[], count = 1) =>
  values
    .map((cents, i) => ({ month: months[months.length - values.length + i]!, cents, count }))
    .filter((p) => p.cents > 0);

describe('fixas × variáveis × eventuais', () => {
  it('monthRange atravessa o ano', () => {
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-11');
    expect(months[2]).toBe('2026-01');
  });

  it('aluguel: todo mês, mesmo valor → fixa', () => {
    const s = analyzeGroup(pts(Array(12).fill(210000)), months);
    expect(s.nature).toBe('fixed');
    expect(s.cv).toBe(0);
    expect(s.avg3).toBe(210000);
  });

  it('reajuste pequeno ainda é fixa', () => {
    const s = analyzeGroup(pts([...Array(6).fill(9990), ...Array(6).fill(10490)]), months);
    expect(s.nature).toBe('fixed');
  });

  it('mercado: todo mês, valor oscila → variável recorrente', () => {
    const s = analyzeGroup(
      pts(
        [80000, 95000, 70000, 120000, 88000, 60000, 99000, 105000, 76000, 91000, 83000, 110000],
        4,
      ),
      months,
    );
    expect(s.nature).toBe('variable_recurring');
    expect(s.minCents).toBe(60000);
    expect(s.maxCents).toBe(120000);
  });

  it('mesmo valor mas várias vezes no mês não é fixa', () => {
    const s = analyzeGroup(pts(Array(12).fill(5000), 3), months);
    expect(s.nature).toBe('variable_recurring');
  });

  it('viagem: 2 meses no ano → eventual', () => {
    expect(analyzeGroup(pts([0, 0, 0, 450000, 0, 0, 0, 0, 0, 120000, 0, 0]), months).nature).toBe(
      'eventual',
    );
  });

  it('tendência dos últimos 3 meses contra os 3 anteriores', () => {
    const s = analyzeGroup(
      pts([10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 14000, 14000, 14000], 5),
      months,
    );
    expect(s.trend3).toBe(0.4);
  });

  it('sem dados', () => {
    const s = analyzeGroup([], months);
    expect(s).toMatchObject({ nature: 'eventual', meanCents: 0, trend3: null });
  });
});
