import { z } from 'zod';
import {
  addMonths,
  clampedDate,
  compare,
  parts,
  startOfMonth,
  type LocalDate,
} from '../dates/local-date';
import { toCents } from '../money';
import type { CashEvent } from '../forecast/project';
import { simulateFinancing, type FinancingResult } from './financing';

/**
 * Mudanças hipotéticas ("e se…") que viram movimentos de caixa somados à previsão. Valores em reais
 * (como a pessoa e a IA falam); a conversão para centavos acontece aqui.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data AAAA-MM-DD');
const reais = z.number().positive().max(100_000_000);

export const scenarioChangeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('one_off'),
    label: z.string().max(80).default('Gasto pontual'),
    date: day,
    amount: reais,
    direction: z.enum(['in', 'out']).default('out'),
  }),
  z.object({
    type: z.literal('recurring'),
    label: z.string().max(80).default('Recorrente'),
    amount: reais.describe('Valor por mês'),
    direction: z.enum(['in', 'out']).default('out'),
    start: day,
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    months: z.number().int().min(1).max(120).optional().describe('Sem valor = até o fim'),
  }),
  z.object({
    type: z.literal('financing'),
    label: z.string().max(80).default('Financiamento'),
    assetPrice: reais.describe('Preço do bem'),
    downPayment: z.number().min(0).default(0).describe('Entrada, paga na data do contrato'),
    monthlyRatePct: z.number().min(0).max(20).describe('Juros ao mês, em %'),
    months: z.number().int().min(1).max(420),
    system: z.enum(['price', 'sac']).default('price'),
    contractDate: day,
    firstDueDate: day.optional(),
    insuranceMonthlyPct: z.number().min(0).max(2).optional(),
    fees: z.number().min(0).optional().describe('Tarifas, em reais (financiadas)'),
    iof: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('card_installments'),
    label: z.string().max(80).default('Compra parcelada'),
    amount: reais.describe('Valor total'),
    installments: z.number().int().min(1).max(48),
    firstDueDate: day.describe('Vencimento da fatura com a 1ª parcela'),
  }),
  z.object({
    type: z.literal('income_change'),
    label: z.string().max(80).default('Mudança de renda'),
    monthlyDelta: z
      .number()
      .refine((v) => v !== 0)
      .describe('Diferença por mês no líquido (+ aumento, − redução)'),
    start: day,
    dayOfMonth: z.number().int().min(1).max(31).optional(),
  }),
]);
export type ScenarioChange = z.infer<typeof scenarioChangeSchema>;

function monthly(start: LocalDate, dom: number, until: LocalDate, max = Infinity): LocalDate[] {
  const out: LocalDate[] = [];
  let m = startOfMonth(start);
  for (let i = 0; out.length < max && i < 600; i++) {
    const { year, month } = parts(m);
    const d = clampedDate(year, month, dom);
    if (compare(d, until) > 0) break;
    if (compare(d, start) >= 0) out.push(d);
    m = addMonths(m, 1);
  }
  return out;
}

/** Movimentos de caixa de uma mudança até `until`, e o cronograma do financiamento quando houver. */
export function changeEvents(
  c: ScenarioChange,
  until: LocalDate,
): { events: CashEvent[]; financing?: FinancingResult } {
  const ev = (date: LocalDate, cents: number, label: string): CashEvent => ({
    date,
    cents,
    label,
    kind: 'planned',
  });
  switch (c.type) {
    case 'one_off':
      return {
        events: [
          ev(c.date as LocalDate, (c.direction === 'in' ? 1 : -1) * toCents(c.amount), c.label),
        ],
      };
    case 'recurring': {
      const start = c.start as LocalDate;
      const sign = c.direction === 'in' ? 1 : -1;
      return {
        events: monthly(start, c.dayOfMonth ?? parts(start).day, until, c.months).map((d) =>
          ev(d, sign * toCents(c.amount), c.label),
        ),
      };
    }
    case 'income_change': {
      const start = c.start as LocalDate;
      return {
        events: monthly(start, c.dayOfMonth ?? parts(start).day, until).map((d) =>
          ev(d, toCents(c.monthlyDelta), c.label),
        ),
      };
    }
    case 'card_installments': {
      const total = toCents(c.amount);
      const base = Math.floor(total / c.installments);
      const first = c.firstDueDate as LocalDate;
      return {
        events: monthly(first, parts(first).day, until, c.installments).map((d, i) =>
          ev(
            d,
            -(i === 0 ? total - base * (c.installments - 1) : base),
            `${c.label} (${i + 1}/${c.installments})`,
          ),
        ),
      };
    }
    case 'financing': {
      const contract = c.contractDate as LocalDate;
      const f = simulateFinancing({
        principalCents: toCents(c.assetPrice - c.downPayment),
        monthlyRatePct: c.monthlyRatePct,
        months: c.months,
        system: c.system,
        contractDate: contract,
        firstDueDate: c.firstDueDate as LocalDate | undefined,
        insuranceMonthlyPct: c.insuranceMonthlyPct,
        feesCents: c.fees ? toCents(c.fees) : 0,
        iof: c.iof,
      });
      const events: CashEvent[] = [];
      if (c.downPayment > 0)
        events.push(ev(contract, -toCents(c.downPayment), `${c.label} (entrada)`));
      for (const p of f.installments)
        if (compare(p.date, until) <= 0)
          events.push(ev(p.date, -p.paymentCents, `${c.label} (${p.n}/${c.months})`));
      return { events, financing: f };
    }
  }
}
