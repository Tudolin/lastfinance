import { describe, expect, it } from 'vitest';
import {
  annualFromDaily,
  iofRate,
  irRate,
  projectGrowth,
  projectTaxFree,
  requiredMonthly,
  savingsAccountAnnual,
} from './yield';

describe('IR e IOF', () => {
  it('IR regressivo nas bordas', () => {
    expect([180, 181, 360, 361, 720, 721].map(irRate)).toEqual([
      0.225, 0.2, 0.2, 0.175, 0.175, 0.15,
    ]);
  });
  it('IOF zera a partir do 30º dia', () => {
    expect(iofRate(1)).toBe(0.96);
    expect(iofRate(29)).toBe(0.03);
    expect(iofRate(30)).toBe(0);
  });
});

describe('projeção', () => {
  it('CDI diário vira anual em 252 dias úteis', () => {
    expect(annualFromDaily(0.05)).toBeCloseTo(1.0005 ** 252 - 1, 12);
  });

  it('R$ 10 mil a 100% do CDI de 12% por 12 meses: bruto 11.200, IR 20% sobre 1.200', () => {
    const p = projectGrowth({
      initialCents: 1_000_000,
      monthlyCents: 0,
      months: 12,
      cdiAnnual: 0.12,
      cdiPct: 100,
    });
    const last = p.at(-1)!;
    expect(last.grossCents).toBe(1_120_000);
    expect(last.irCents).toBe(24_000); // 360 dias → 20%
    expect(last.netCents).toBe(1_096_000);
  });

  it('aportes mais novos pagam alíquota maior', () => {
    const p = projectGrowth({
      initialCents: 0,
      monthlyCents: 100_000,
      months: 24,
      cdiAnnual: 0.12,
      cdiPct: 100,
    });
    const last = p.at(-1)!;
    expect(last.investedCents).toBe(2_400_000);
    const profit = last.grossCents - last.investedCents;
    expect(last.irCents / profit).toBeGreaterThan(0.15);
    expect(last.irCents / profit).toBeLessThan(0.225);
  });

  it('poupança: 0,5% a.m. com Selic alta, 70% da Selic com Selic baixa', () => {
    expect(savingsAccountAnnual(0.14)).toBeCloseTo(1.005 ** 12 - 1, 12);
    expect(savingsAccountAnnual(0.07)).toBeCloseTo(0.049, 12);
    expect(projectTaxFree(100_000, 0, 12, 0)).toBe(100_000);
  });

  it('aporte necessário atinge a meta e um centavo a menos não', () => {
    const g = { initialCents: 500_000, months: 18, cdiAnnual: 0.13, cdiPct: 105 };
    const m = requiredMonthly(5_000_000, g);
    const net = (mc: number) => projectGrowth({ ...g, monthlyCents: mc }).at(-1)!.netCents;
    expect(net(m)).toBeGreaterThanOrEqual(5_000_000);
    expect(net(m - 1)).toBeLessThan(5_000_000);
    expect(requiredMonthly(100, g)).toBe(0);
  });
});
