import { z } from 'zod';
import { bankingCalendar } from '../dates/business-days';
import {
  addMonths,
  daysInMonth,
  parts,
  startOfMonth,
  ymd,
  type LocalDate,
} from '../dates/local-date';
import type { Cents } from '../money';
import type { ForecastDraft } from '../forecast/types';
import {
  cltNet,
  prorateFirstMonth,
  thirteenthFirst,
  thirteenthSecond,
  vacationPay,
  type BreakdownLine,
  type CltDeductions,
} from '../tax/clt';
import { pjNet, type PjConfig } from '../tax/pj';
import type { TaxTables } from '../tax/tables';
import { paymentDates, type PaymentRule } from './payment-rule';

export const cltDeductionsSchema = z.object({
  dependents: z.number().int().min(0).max(20).optional(),
  alimony: z.number().int().min(0).optional(),
  privatePension: z.number().int().min(0).optional(),
  transportVoucher: z.number().int().min(0).nullable().optional(),
  others: z
    .array(z.object({ label: z.string().min(1).max(60), cents: z.number().int().min(0) }))
    .optional(),
});

export const pjConfigSchema = z.object({
  regime: z.enum(['mei', 'simples', 'presumido', 'manual']),
  meiActivity: z.enum(['services', 'commerce', 'both']).optional(),
  simplesAnnex: z.enum(['iii', 'v', 'fator_r']).optional(),
  rbt12: z.number().int().min(0).nullable().optional(),
  payroll12: z.number().int().min(0).nullable().optional(),
  issRate: z.number().min(0).max(0.05).optional(),
  manualRate: z.number().min(0).max(1).optional(),
  proLabore: z.number().int().min(0).optional(),
  monthlyCosts: z.number().int().min(0).optional(),
  dependents: z.number().int().min(0).max(20).optional(),
});

export type IncomeType = 'clt' | 'pj' | 'other';
export type IncomeEventType = '13_1' | '13_2' | 'vacation' | 'plr' | 'bonus' | 'other';

export const INCOME_EVENT_LABEL: Record<IncomeEventType, string> = {
  '13_1': '13º — 1ª parcela',
  '13_2': '13º — 2ª parcela',
  vacation: 'Férias',
  plr: 'PLR',
  bonus: 'Bônus',
  other: 'Outro',
};

export type IncomeSourceDef = {
  id: string;
  name: string;
  type: IncomeType;
  accountId: string | null;
  categoryId: string | null;
  matchPattern: string | null;
  startDate: LocalDate;
  endDate: LocalDate | null;
  active: boolean;
  paymentRule: PaymentRule;
  deductions: CltDeductions;
  pjConfig: PjConfig | null;
  prorateFirstMonth: boolean;
  /** Bruto (CLT), faturamento (PJ) ou valor (outros), com vigência. */
  salaryHistory: { grossCents: Cents; validFrom: LocalDate; validTo: LocalDate | null }[];
  events: {
    id: string;
    type: IncomeEventType;
    expectedDate: LocalDate;
    grossCents: Cents | null;
    netCents: Cents | null;
    vacationDays: number | null;
  }[];
  /** Fator (real ÷ previsto) aprendido na conciliação; 1 = sem calibração. */
  calibrationFactor: number;
  forecastMode?: 'calculated' | 'calibrated';
};

export type MonthlyNet = { gross: Cents; net: Cents; lines: BreakdownLine[]; estimated: boolean };

export function salaryAt(
  src: Pick<IncomeSourceDef, 'salaryHistory'>,
  date: LocalDate,
): Cents | null {
  const h = [...src.salaryHistory]
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))
    .find((s) => s.validFrom <= date && (s.validTo == null || s.validTo >= date));
  return h?.grossCents ?? null;
}

/** Líquido de uma competência pelo tipo de renda. */
export function netForGross(
  src: Pick<IncomeSourceDef, 'type' | 'deductions' | 'pjConfig'>,
  gross: Cents,
  tables: TaxTables,
): MonthlyNet {
  if (src.type === 'clt') {
    const r = cltNet({ gross, ...src.deductions }, tables);
    return { gross, net: r.net, lines: r.lines, estimated: false };
  }
  if (src.type === 'pj') {
    const r = pjNet(gross, src.pjConfig ?? { regime: 'manual', manualRate: 0 }, tables);
    return { gross, net: r.net, lines: r.lines, estimated: true };
  }
  return { gross, net: gross, lines: [{ label: 'Valor', cents: gross }], estimated: true };
}

function windowFor(date: LocalDate) {
  return {
    windowStart: bankingCalendar.addBusinessDays(date, -3),
    windowEnd: bankingCalendar.addBusinessDays(date, 5),
  };
}

/** Distribui o total entre as partes sem perder centavos (o resto vai para a última). */
function splitCents(total: Cents, pcts: readonly number[]): Cents[] {
  const out = pcts.map((p) => Math.floor((total * p) / 100));
  out[out.length - 1]! += total - out.reduce((a, b) => a + b, 0);
  return out;
}

/**
 * Gera as entradas previstas de uma fonte de renda com data esperada em [from, to].
 * Salário: uma entrada por parte da regra de pagamento; eventos: 13º, férias, PLR, bônus.
 */
export function incomeDrafts(
  src: IncomeSourceDef,
  from: LocalDate,
  to: LocalDate,
  tablesFor: (d: LocalDate) => TaxTables,
  extraHolidays: readonly LocalDate[] = [],
): ForecastDraft[] {
  if (!src.active) return [];
  const out: ForecastDraft[] = [];
  const spread = src.type === 'clt' ? 0.02 : src.type === 'pj' ? 0.1 : 0.05;
  const push = (d: {
    sourceId: string;
    label: string;
    expectedDate: LocalDate;
    expectedCents: Cents;
    estimated: boolean;
    breakdown: unknown;
  }) => {
    if (d.expectedDate < from || d.expectedDate > to || d.expectedCents <= 0) return;
    const { estimated, ...rest } = d;
    out.push({
      ...rest,
      sourceType: 'income',
      direction: 'in',
      accountId: src.accountId,
      categoryId: src.categoryId,
      matchPattern: src.matchPattern,
      cashDate: d.expectedDate,
      ...windowFor(d.expectedDate),
      lowCents: Math.round(d.expectedCents * (1 - spread)),
      highCents: Math.round(d.expectedCents * (1 + spread)),
      certainty: estimated ? 'estimated' : 'certain',
      tolerancePct: Math.max(0.05, spread * 2),
    });
  };

  // Competências que podem pagar dentro da janela (pagamento até 1 mês depois).
  let month = addMonths(startOfMonth(from), -1);
  const lastMonth = startOfMonth(to);
  const start = startOfMonth(src.startDate);
  while (month <= lastMonth) {
    const { year, month: m } = parts(month);
    const monthEnd = ymd(year, m, daysInMonth(year, m));
    const active = month >= start && (src.endDate == null || src.endDate >= month);
    const ref = src.startDate > month ? src.startDate : month;
    const baseGross = active ? salaryAt(src, ref) : null;
    if (baseGross != null) {
      let gross = baseGross;
      const isFirst = month === start && src.prorateFirstMonth;
      if (isFirst)
        gross = prorateFirstMonth(baseGross, parts(src.startDate).day, daysInMonth(year, m));
      if (src.endDate && src.endDate < monthEnd)
        gross = Math.round((gross * Math.min(30, parts(src.endDate).day)) / 30);
      const calc = netForGross(src, gross, tablesFor(month));
      const net = Math.round(calc.net * src.calibrationFactor);
      const dates = paymentDates(src.paymentRule, year, m, extraHolidays);
      const amounts = splitCents(
        net,
        dates.map((d) => d.pct),
      );
      dates.forEach((d, i) =>
        push({
          sourceId: src.id,
          label: `${src.name}${dates.length > 1 ? ` (${d.pct}%)` : ''}${isFirst && gross !== baseGross ? ' — proporcional' : ''}`,
          expectedDate: d.date,
          expectedCents: amounts[i]!,
          estimated: calc.estimated || src.calibrationFactor !== 1,
          breakdown: {
            competence: month.slice(0, 7),
            gross: calc.gross,
            net: calc.net,
            calibrationFactor: src.calibrationFactor,
            pct: d.pct,
            lines: calc.lines,
          },
        }),
      );
    }
    month = addMonths(month, 1);
  }

  for (const ev of src.events) {
    const tables = tablesFor(ev.expectedDate);
    const gross = ev.grossCents ?? salaryAt(src, ev.expectedDate) ?? 0;
    let net: Cents = 0;
    let lines: BreakdownLine[] = [];
    let estimated = src.type !== 'clt';
    if (ev.netCents != null) {
      net = ev.netCents;
      lines = [{ label: 'Valor líquido informado', cents: net }];
    } else if (src.type === 'clt') {
      switch (ev.type) {
        case '13_1':
          net = thirteenthFirst(gross);
          lines = [{ label: 'Metade do 13º (sem descontos)', cents: net }];
          break;
        case '13_2': {
          const r = thirteenthSecond(gross, tables, { dependents: src.deductions.dependents });
          net = r.net;
          lines = r.lines;
          break;
        }
        case 'vacation': {
          const r = vacationPay(gross, ev.vacationDays ?? 30, tables, {
            dependents: src.deductions.dependents,
          });
          net = r.net;
          lines = r.lines;
          break;
        }
        case 'bonus': {
          // Bônus entra na folha do mês: o líquido é a diferença marginal.
          const base = salaryAt(src, ev.expectedDate) ?? 0;
          const withBonus = cltNet({ gross: base, extraTaxable: gross, ...src.deductions }, tables);
          const without = cltNet({ gross: base, ...src.deductions }, tables);
          net = withBonus.net - without.net;
          lines = [
            { label: 'Bônus bruto', cents: gross },
            { label: 'INSS + IRRF adicionais', cents: net - gross },
          ];
          break;
        }
        default:
          // PLR tem tabela exclusiva própria; sem o líquido informado, usamos o bruto (estimado).
          net = gross;
          estimated = true;
          lines = [{ label: 'Bruto (informe o líquido para precisão)', cents: gross }];
      }
    } else {
      net = gross;
      lines = [{ label: 'Valor', cents: gross }];
    }
    push({
      sourceId: ev.id,
      label: `${src.name} — ${INCOME_EVENT_LABEL[ev.type]}`,
      expectedDate: bankingCalendar.previousOrSame(ev.expectedDate),
      expectedCents: net,
      estimated,
      breakdown: { event: ev.type, gross, net, lines },
    });
  }
  return out;
}

/** Datas legais padrão do 13º: 1ª parcela até 30/11, 2ª até 20/12 (antecipando se não for útil). */
export function defaultThirteenthDates(year: number) {
  return {
    first: bankingCalendar.previousOrSame(ymd(year, 11, 30)),
    second: bankingCalendar.previousOrSame(ymd(year, 12, 20)),
  };
}
