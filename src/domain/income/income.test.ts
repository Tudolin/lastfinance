import { describe, expect, it } from 'vitest';
import type { LocalDate } from '../dates/local-date';
import { defaultTaxTables } from '../tax/tables';
import { incomeDrafts, type IncomeSourceDef } from './generate';
import {
  DEFAULT_CLT_RULE,
  describePaymentRule,
  paymentDates,
  type PaymentRule,
} from './payment-rule';

const d = (s: string) => s as LocalDate;
const T = defaultTaxTables();

describe('regras de pagamento', () => {
  it('5º dia útil do mês seguinte (sábado conta): cai no sábado → crédito na sexta', () => {
    // Novembro/2026: 2 é Finados; 3,4,5,6 e sábado 7 = 5º dia útil trabalhista.
    expect(paymentDates(DEFAULT_CLT_RULE, 2026, 10)).toEqual([{ date: '2026-11-06', pct: 100 }]);
  });

  it('5º dia útil sem contar sábado', () => {
    const rule: PaymentRule = { ...DEFAULT_CLT_RULE, saturdayIsBusinessDay: false };
    expect(paymentDates(rule, 2026, 10)[0]!.date).toBe('2026-11-09');
  });

  it('último dia útil e dia fixo com ajuste', () => {
    const last: PaymentRule = {
      parts: [{ pct: 100, rule: { type: 'last_business_day' }, monthOffset: 0 }],
      saturdayIsBusinessDay: false,
    };
    expect(paymentDates(last, 2026, 10)[0]!.date).toBe('2026-10-30'); // 31/10 é sábado
    const fixed = (adjust: 'previous' | 'next' | 'none'): PaymentRule => ({
      parts: [{ pct: 100, rule: { type: 'fixed_day', day: 20, adjust }, monthOffset: 0 }],
      saturdayIsBusinessDay: false,
    });
    expect(paymentDates(fixed('previous'), 2026, 9)[0]!.date).toBe('2026-09-18'); // 20/09 é domingo
    expect(paymentDates(fixed('next'), 2026, 9)[0]!.date).toBe('2026-09-21');
  });

  it('dia 31 em mês de 30 dias usa o último dia', () => {
    const r: PaymentRule = {
      parts: [
        { pct: 100, rule: { type: 'fixed_day', day: 31, adjust: 'previous' }, monthOffset: 0 },
      ],
      saturdayIsBusinessDay: false,
    };
    expect(paymentDates(r, 2026, 4)[0]!.date).toBe('2026-04-30');
  });

  it('descreve a regra em português', () => {
    expect(describePaymentRule(DEFAULT_CLT_RULE)).toBe('5º dia útil do mês seguinte');
  });
});

function clt(over: Partial<IncomeSourceDef> = {}): IncomeSourceDef {
  return {
    id: 'src-1',
    name: 'Empresa X',
    type: 'clt',
    accountId: 'acc-1',
    categoryId: null,
    matchPattern: 'EMPRESA X',
    startDate: d('2025-01-01'),
    endDate: null,
    active: true,
    paymentRule: DEFAULT_CLT_RULE,
    deductions: {},
    pjConfig: null,
    prorateFirstMonth: true,
    salaryHistory: [{ grossCents: 600000, validFrom: d('2025-01-01'), validTo: null }],
    events: [],
    calibrationFactor: 1,
    ...over,
  };
}

describe('entradas previstas de renda', () => {
  it('salário mensal líquido nas datas certas', () => {
    const out = incomeDrafts(clt(), d('2026-11-01'), d('2026-12-31'), () => T);
    expect(out.map((o) => [o.expectedDate, o.expectedCents])).toEqual([
      ['2026-11-06', 497339],
      ['2026-12-04', 497339],
    ]);
    expect(out[0]!.certainty).toBe('certain');
    expect(out[0]!.windowStart < out[0]!.expectedDate).toBe(true);
  });

  it('reajuste com vigência muda o valor a partir da competência', () => {
    const out = incomeDrafts(
      clt({
        salaryHistory: [
          { grossCents: 600000, validFrom: d('2025-01-01'), validTo: d('2026-10-31') },
          { grossCents: 700000, validFrom: d('2026-11-01'), validTo: null },
        ],
      }),
      d('2026-11-01'),
      d('2026-12-31'),
      () => T,
    );
    expect(out[0]!.expectedCents).toBe(497339); // competência outubro
    expect(out[1]!.expectedCents).toBeGreaterThan(497339); // competência novembro
  });

  it('proporcional no 1º mês', () => {
    const out = incomeDrafts(
      clt({
        startDate: d('2026-09-16'),
        salaryHistory: [{ grossCents: 600000, validFrom: d('2026-09-16'), validTo: null }],
      }),
      d('2026-10-01'),
      d('2026-10-31'),
      () => T,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toContain('proporcional');
    expect((out[0]!.breakdown as { gross: number }).gross).toBe(300000); // 15 dias
  });

  it('adiantamento + saldo somam o líquido sem perder centavos', () => {
    const rule: PaymentRule = {
      parts: [
        { pct: 40, rule: { type: 'fixed_day', day: 20, adjust: 'previous' }, monthOffset: 0 },
        { pct: 60, rule: { type: 'nth_business_day', n: 5 }, monthOffset: 1 },
      ],
      saturdayIsBusinessDay: true,
    };
    const out = incomeDrafts(clt({ paymentRule: rule }), d('2026-10-01'), d('2026-11-30'), () => T);
    const octComp = out.filter(
      (o) => (o.breakdown as { competence: string }).competence === '2026-10',
    );
    expect(octComp).toHaveLength(2);
    expect(octComp.reduce((s, o) => s + o.expectedCents, 0)).toBe(497339);
  });

  it('13º em duas parcelas nas datas legais', () => {
    const out = incomeDrafts(
      clt({
        events: [
          {
            id: 'e1',
            type: '13_1',
            expectedDate: d('2026-11-30'),
            grossCents: null,
            netCents: null,
            vacationDays: null,
          },
          {
            id: 'e2',
            type: '13_2',
            expectedDate: d('2026-12-20'),
            grossCents: null,
            netCents: null,
            vacationDays: null,
          },
        ],
      }),
      d('2026-11-01'),
      d('2026-12-31'),
      () => T,
    );
    const e1 = out.find((o) => o.sourceId === 'e1')!;
    const e2 = out.find((o) => o.sourceId === 'e2')!;
    expect(e1.expectedCents).toBe(300000);
    expect(e2.expectedDate).toBe('2026-12-18'); // 20/12 é domingo
    expect(e2.expectedCents).toBe(600000 - 64151 - 38510 - 300000);
  });

  it('calibração aplica o fator aprendido e marca como estimado', () => {
    const out = incomeDrafts(
      clt({ calibrationFactor: 1.02 }),
      d('2026-11-01'),
      d('2026-11-30'),
      () => T,
    );
    expect(out[0]!.expectedCents).toBe(Math.round(497339 * 1.02));
    expect(out[0]!.certainty).toBe('estimated');
  });

  it('PJ é estimado e respeita fim do contrato', () => {
    const out = incomeDrafts(
      clt({
        type: 'pj',
        pjConfig: { regime: 'mei' },
        endDate: d('2026-10-31'),
        paymentRule: {
          parts: [
            { pct: 100, rule: { type: 'fixed_day', day: 10, adjust: 'next' }, monthOffset: 1 },
          ],
          saturdayIsBusinessDay: false,
        },
      }),
      d('2026-10-01'),
      d('2026-12-31'),
      () => T,
    );
    expect(out.map((o) => o.expectedDate)).toEqual(['2026-10-13', '2026-11-10']); // 10 e 11/10 fim de semana, 12 feriado
    expect(out.every((o) => o.certainty === 'estimated')).toBe(true);
  });
});
