import { z } from 'zod';
import { BusinessCalendar } from '../dates/business-days';
import { addMonths, clampedDate, parts, ymd, type LocalDate } from '../dates/local-date';

/** Regra do dia de pagamento de uma parte do salário. */
export const dayRuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fixed_day'),
    day: z.number().int().min(1).max(31),
    /** Se cair em dia não útil: antecipa, adia ou mantém. */
    adjust: z.enum(['previous', 'next', 'none']).default('previous'),
  }),
  z.object({ type: z.literal('nth_business_day'), n: z.number().int().min(1).max(23) }),
  z.object({ type: z.literal('last_business_day') }),
]);
export type DayRule = z.infer<typeof dayRuleSchema>;

export const paymentRuleSchema = z.object({
  /** Partes do pagamento (ex.: adiantamento de 40% no dia 20 + 60% no 5º dia útil do mês seguinte). */
  parts: z
    .array(
      z.object({
        pct: z.number().gt(0).max(100),
        rule: dayRuleSchema,
        /** 0 = paga no próprio mês de competência; 1 = no mês seguinte. */
        monthOffset: z.number().int().min(0).max(1).default(0),
      }),
    )
    .min(1)
    .refine((ps) => Math.abs(ps.reduce((s, p) => s + p.pct, 0) - 100) < 0.001, {
      message: 'As partes precisam somar 100%.',
    }),
  /** Prazo da CLT (art. 459): o sábado conta como dia útil. */
  saturdayIsBusinessDay: z.boolean().default(false),
});
export type PaymentRule = z.infer<typeof paymentRuleSchema>;

export const DEFAULT_CLT_RULE: PaymentRule = {
  parts: [{ pct: 100, rule: { type: 'nth_business_day', n: 5 }, monthOffset: 1 }],
  saturdayIsBusinessDay: true,
};

export function describeDayRule(r: DayRule): string {
  switch (r.type) {
    case 'fixed_day':
      return `dia ${r.day}${r.adjust === 'previous' ? ' (antecipa se não for útil)' : r.adjust === 'next' ? ' (adia se não for útil)' : ''}`;
    case 'nth_business_day':
      return `${r.n}º dia útil`;
    case 'last_business_day':
      return 'último dia útil';
  }
}

export function describePaymentRule(rule: PaymentRule): string {
  return rule.parts
    .map(
      (p) =>
        `${rule.parts.length > 1 ? `${p.pct}% no ` : ''}${describeDayRule(p.rule)}${p.monthOffset ? ' do mês seguinte' : ''}`,
    )
    .join(' + ');
}

const calendars = new Map<string, BusinessCalendar>();
function calendarFor(saturday: boolean, extra: readonly LocalDate[]) {
  const key = `${saturday}|${extra.join(',')}`;
  let c = calendars.get(key);
  if (!c) {
    c = new BusinessCalendar({ saturdayIsBusinessDay: saturday, extraHolidays: extra });
    calendars.set(key, c);
  }
  return c;
}

export function dayForRule(
  r: DayRule,
  year: number,
  month: number,
  cal: BusinessCalendar,
): LocalDate {
  switch (r.type) {
    case 'fixed_day': {
      const d = clampedDate(year, month, r.day);
      if (r.adjust === 'none') return d;
      return r.adjust === 'previous' ? cal.previousOrSame(d) : cal.nextOrSame(d);
    }
    case 'nth_business_day':
      return cal.nthBusinessDay(year, month, r.n);
    case 'last_business_day':
      return cal.lastBusinessDay(year, month);
  }
}

/**
 * Datas de pagamento da competência (`year`/`month`). Cada parte devolve a data e o percentual.
 * O dinheiro cai na conta em dia bancário: se a regra trabalhista apontar um sábado, o crédito
 * chega no dia útil bancário anterior.
 */
export function paymentDates(
  rule: PaymentRule,
  year: number,
  month: number,
  extraHolidays: readonly LocalDate[] = [],
): { date: LocalDate; pct: number }[] {
  const ruleCal = calendarFor(rule.saturdayIsBusinessDay, extraHolidays);
  const bankCal = calendarFor(false, extraHolidays);
  return rule.parts.map((p) => {
    const ref = parts(addMonths(ymd(year, month, 1), p.monthOffset));
    const d = dayForRule(p.rule, ref.year, ref.month, ruleCal);
    return { date: bankCal.previousOrSame(d), pct: p.pct };
  });
}
