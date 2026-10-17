import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { localDate } from '../dates/local-date';
import { pricePayment, simulateFinancing } from './financing';
import { irr } from './irr';

const contractDate = localDate('2026-12-01');

describe('irr', () => {
  it('acha a taxa de uma série Price', () => {
    const pmt = pricePayment(10000, 0.02, 12);
    expect(irr([10000, ...Array(12).fill(-pmt)])!).toBeCloseTo(0.02, 10);
  });
  it('sem troca de sinal não há taxa', () => {
    expect(irr([100, 50])).toBeNull();
  });
  it('cai na bisseção quando Newton diverge', () => {
    const pmt = pricePayment(10000, 0.02, 12);
    expect(irr([10000, ...Array(12).fill(-pmt)], 50)!).toBeCloseTo(0.02, 8);
  });
});

describe('simulateFinancing', () => {
  it('Price confere com a HP-12C: R$ 60 mil, 1,5% a.m., 48x = R$ 1.762,50', () => {
    const r = simulateFinancing({
      principalCents: 6_000_000,
      monthlyRatePct: 1.5,
      months: 48,
      system: 'price',
      contractDate,
      iof: false,
    });
    expect(r.firstPaymentCents).toBe(176_250);
    expect(Math.abs(r.lastPaymentCents - 176_250)).toBeLessThanOrEqual(60);
    expect(r.installments.at(-1)!.balanceCents).toBe(0);
    expect(r.cetMonthly!).toBeCloseTo(0.015, 5);
    expect(r.cetAnnual!).toBeCloseTo(1.015 ** 12 - 1, 5);
  });

  it('SAC: amortização constante, 1ª parcela maior e decrescente', () => {
    const r = simulateFinancing({
      principalCents: 6_000_000,
      monthlyRatePct: 1.5,
      months: 48,
      system: 'sac',
      contractDate,
      iof: false,
    });
    expect(r.firstPaymentCents).toBe(125_000 + 90_000);
    expect(r.lastPaymentCents).toBe(125_000 + 1_875);
    expect(r.totalInterestCents).toBe(2_205_000); // 0,015 × 1250 × (48·49/2)
    const price = simulateFinancing({
      ...r,
      principalCents: 6_000_000,
      monthlyRatePct: 1.5,
      months: 48,
      system: 'price',
      contractDate,
      iof: false,
    });
    expect(r.totalInterestCents).toBeLessThan(price.totalInterestCents);
  });

  it('IOF, seguro e tarifas elevam o CET acima da taxa', () => {
    const r = simulateFinancing({
      principalCents: 6_000_000,
      monthlyRatePct: 1.5,
      months: 48,
      system: 'price',
      contractDate,
      insuranceMonthlyPct: 0.05,
      feesCents: 90_000,
    });
    // 0,38% + 0,0082%/dia, limitado a 365 dias → no máximo 3,38%
    expect(r.iofCents).toBeGreaterThan(6_000_000 * 0.0038);
    expect(r.iofCents).toBeLessThan(6_090_000 * 0.0338);
    expect(r.financedCents).toBe(6_000_000 + 90_000 + r.iofCents);
    expect(r.cetMonthly!).toBeGreaterThan(0.015);
  });

  it('tarifa paga à vista reduz o valor recebido no CET', () => {
    const financed = simulateFinancing({
      principalCents: 1_000_000,
      monthlyRatePct: 2,
      months: 12,
      system: 'price',
      contractDate,
      feesCents: 50_000,
      iof: false,
    });
    const upfront = simulateFinancing({
      principalCents: 1_000_000,
      monthlyRatePct: 2,
      months: 12,
      system: 'price',
      contractDate,
      feesCents: 50_000,
      financeFees: false,
      iof: false,
    });
    expect(upfront.financedCents).toBe(1_000_000);
    expect(upfront.cetMonthly!).toBeGreaterThan(0.02);
    expect(financed.cetMonthly!).toBeGreaterThan(0.02);
  });

  it('propriedade: amortizações somam o financiado e o saldo termina em zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100_000, max: 50_000_000 }),
        fc.double({ min: 0, max: 5, noNaN: true }),
        fc.integer({ min: 1, max: 120 }),
        fc.constantFrom('price' as const, 'sac' as const),
        (p, rate, n, system) => {
          const r = simulateFinancing({
            principalCents: p,
            monthlyRatePct: rate,
            months: n,
            system,
            contractDate,
          });
          const amort = r.installments.reduce((s, i) => s + i.amortizationCents, 0);
          expect(amort).toBe(r.financedCents);
          expect(r.installments.at(-1)!.balanceCents).toBe(0);
          expect(r.totalPaidCents).toBeGreaterThanOrEqual(r.financedCents);
        },
      ),
      { numRuns: 200 },
    );
  });
});
