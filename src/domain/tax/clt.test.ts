import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocateInss,
  annualAdjustment,
  cltNet,
  inssEmployee,
  inssMax,
  irrfMonthly,
  lei15270Reduction,
  multipleEmployments,
  prorateFirstMonth,
  thirteenthFirst,
  thirteenthSecond,
  vacationPay,
} from './clt';
import { DEFAULT_TAX_TABLES, defaultTaxTables, resolveTaxTables } from './tables';
import type { LocalDate } from '../dates/local-date';

const T = defaultTaxTables();

describe('INSS 2026', () => {
  it.each([
    [0, 0],
    [162100, 12158], // 7,5% de 1.621,00 = 121,575 → 121,58
    [300000, 24860], // 121,575 + 115,3656 + 11,6592
    [500000, 50151],
    [847555, 98809], // teto
    [1000000, 98809], // acima do teto: desconto máximo
  ])('bruto %i → INSS %i', (gross, inss) => {
    expect(inssEmployee(gross, T.inss_employee)).toBe(inss);
  });

  it('desconto máximo é R$ 988,09', () => {
    expect(inssMax(T.inss_employee)).toBe(98809);
  });

  it('é monotônico e nunca passa do teto', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (g, d) => {
          const a = inssEmployee(g, T.inss_employee);
          const b = inssEmployee(g + d, T.inss_employee);
          return a <= b && b <= 98809;
        },
      ),
    );
  });

  it('dois vínculos: teto único rateado proporcionalmente', () => {
    const shares = allocateInss([600000, 600000], T.inss_employee);
    expect(shares[0]! + shares[1]!).toBe(98809);
    expect(Math.abs(shares[0]! - shares[1]!)).toBeLessThanOrEqual(1);
    const one = allocateInss([400000, 400000], T.inss_employee);
    expect(one[0]! + one[1]!).toBe(inssEmployee(800000, T.inss_employee));
  });
});

describe('IRRF mensal + Lei 15.270', () => {
  it('R$ 5.000,00: imposto zerado pela redução', () => {
    const inss = inssEmployee(500000, T.inss_employee);
    const r = irrfMonthly({ taxable: 500000, inss }, T);
    expect(r.taxBeforeReduction).toBe(31289); // simplificado: 4.392,80 × 22,5% − 675,49
    expect(r.mode).toBe('simplified');
    expect(r.irrf).toBe(0);
  });

  it('R$ 5.000,01: redução parcial ainda zera (continuidade da fórmula)', () => {
    const inss = inssEmployee(500001, T.inss_employee);
    const r = irrfMonthly({ taxable: 500001, inss }, T);
    expect(r.reduction).toBe(31289); // 978,62 − 0,133145 × 5.000,01 = 312,89
    expect(r.irrf).toBe(0);
  });

  it('R$ 6.000,00: deduções legais e redução de R$ 179,75', () => {
    const inss = inssEmployee(600000, T.inss_employee);
    expect(inss).toBe(64151);
    const r = irrfMonthly({ taxable: 600000, inss }, T);
    expect(r.mode).toBe('legal');
    expect(r.taxBeforeReduction).toBe(56485);
    expect(r.reduction).toBe(17975);
    expect(r.irrf).toBe(38510);
  });

  it('R$ 7.350,00: redução praticamente nula; R$ 7.350,01: nenhuma', () => {
    expect(lei15270Reduction(735000, 100000, T.irrf_reduction_monthly)).toBe(0);
    expect(lei15270Reduction(735001, 100000, T.irrf_reduction_monthly)).toBe(0);
    expect(lei15270Reduction(734000, 100000, T.irrf_reduction_monthly)).toBe(134); // 978,62 − 977,2843 = 1,3357
  });

  it('a redução nunca passa do imposto', () => {
    expect(lei15270Reduction(300000, 5000, T.irrf_reduction_monthly)).toBe(5000);
    expect(lei15270Reduction(300000, 0, T.irrf_reduction_monthly)).toBe(0);
  });

  it('dependentes: legal × simplificado escolhe o menor imposto', () => {
    const inss = inssEmployee(1000000, T.inss_employee);
    const sem = irrfMonthly({ taxable: 1000000, inss }, T);
    const com = irrfMonthly({ taxable: 1000000, inss, dependents: 3 }, T);
    expect(com.irrf).toBeLessThan(sem.irrf);
    expect(com.mode).toBe('legal');
    expect(com.irrf).toBe(Math.min(com.legal.tax, com.simplified.tax));
  });

  it('IRRF nunca é negativo e não diminui com o salário acima da faixa de redução', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 735001, max: 5_000_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        (g, d) => {
          const a = irrfMonthly({ taxable: g, inss: inssEmployee(g, T.inss_employee) }, T).irrf;
          const b = irrfMonthly(
            { taxable: g + d, inss: inssEmployee(g + d, T.inss_employee) },
            T,
          ).irrf;
          return a >= 0 && b >= a;
        },
      ),
    );
  });
});

describe('líquido CLT', () => {
  it('R$ 6.000 com VT e plano de saúde', () => {
    const r = cltNet(
      {
        gross: 600000,
        transportVoucher: 25000,
        others: [{ label: 'Plano de saúde', cents: 15000 }],
      },
      T,
    );
    expect(r.inss).toBe(64151);
    expect(r.irrf.irrf).toBe(38510);
    expect(r.transportVoucher).toBe(25000); // 6% = 360,00, limitado ao benefício de 250,00
    expect(r.net).toBe(600000 - 64151 - 38510 - 25000 - 15000);
    expect(r.lines.reduce((s, l) => s + l.cents, 0)).toBe(r.net);
  });

  it('as linhas sempre somam o líquido', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100000, max: 3_000_000 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 50_000 }),
        (gross, dependents, alimony) => {
          const r = cltNet({ gross, dependents, alimony, transportVoucher: 30000 }, T);
          return r.lines.reduce((s, l) => s + l.cents, 0) === r.net;
        },
      ),
    );
  });
});

describe('13º, férias e proporcional', () => {
  it('13º: 1ª parcela é metade; 2ª desconta INSS, IRRF e a 1ª', () => {
    expect(thirteenthFirst(600000)).toBe(300000);
    const s = thirteenthSecond(600000, T);
    expect(s.inss).toBe(64151);
    expect(s.irrf.irrf).toBe(38510);
    expect(s.net).toBe(600000 - 64151 - 38510 - 300000);
    expect(thirteenthFirst(600000, 6)).toBe(150000);
  });

  it('férias de 30 dias com 1/3', () => {
    const v = vacationPay(300000, 30, T);
    expect(v.gross).toBe(400000);
    expect(v.net).toBe(400000 - v.inss - v.irrf.irrf);
  });

  it('proporcional do 1º mês em mês comercial', () => {
    expect(prorateFirstMonth(300000, 1, 31)).toBe(300000);
    expect(prorateFirstMonth(300000, 16, 30)).toBe(150000); // 15 dias
    expect(prorateFirstMonth(300000, 15, 28)).toBe(140000); // 14 dias
  });
});

describe('ajuste anual e vários vínculos', () => {
  it('dois vínculos de R$ 4.000: retenção zero em cada folha, imposto a pagar no ajuste', () => {
    const m = multipleEmployments([{ gross: 400000 }, { gross: 400000 }], T);
    expect(m.perJob.every((j) => j.irrf.irrf === 0)).toBe(true);
    expect(m.perJob[0]!.inss + m.perJob[1]!.inss).toBe(inssEmployee(800000, T.inss_employee));
    expect(m.annual.mode).toBe('simplified');
    expect(m.annual.balance).toBe(1064434); // base 78.360 (teto de 17.640) × 27,5% − 10.904,66
    expect(m.annual.monthlyProvision).toBe(88703);
  });

  it('um vínculo de R$ 5.000: isento no ano', () => {
    const inss = inssEmployee(500000, T.inss_employee);
    const r = annualAdjustment({ taxable: 6000000, inss: inss * 12, withheld: 0 }, T);
    expect(r.tax).toBe(0);
    expect(r.balance).toBe(0);
    expect(r.monthlyProvision).toBe(0);
  });
});

describe('tabelas versionadas', () => {
  it('escolhe a vigente e avisa quando não há', () => {
    const extra = {
      ...DEFAULT_TAX_TABLES.find((t) => t.kind === 'inss_employee')!,
      validFrom: '2027-01-01' as LocalDate,
      payload: { brackets: [{ upTo: 900000, rate: 0.1 }] },
    };
    const rows = [...DEFAULT_TAX_TABLES, extra];
    expect(
      resolveTaxTables(rows, '2026-12-31' as LocalDate).tables.inss_employee.brackets,
    ).toHaveLength(4);
    expect(
      resolveTaxTables(rows, '2027-02-01' as LocalDate).tables.inss_employee.brackets,
    ).toHaveLength(1);
    expect(resolveTaxTables(DEFAULT_TAX_TABLES, '2025-01-01' as LocalDate).fallbacks).toContain(
      'inss_employee',
    );
  });
});
