import { addDays, diffDays, type LocalDate } from '../dates/local-date';
import type { Cents } from '../money';

export type CashEventKind =
  'income' | 'recurring' | 'planned' | 'installment' | 'bill' | 'overdue' | 'purchase';

/**
 * Um movimento de caixa futuro. `cents` tem sinal (+ entra / − sai).
 * `pessimisticCents`/`optimisticCents` são o pior e o melhor efeito plausível no saldo
 * (para uma saída, o pessimista é mais negativo; para uma entrada, é menor).
 */
export type CashEvent = {
  date: LocalDate;
  cents: Cents;
  pessimisticCents?: Cents;
  optimisticCents?: Cents;
  label: string;
  kind: CashEventKind;
  accountId?: string | null;
  estimated?: boolean;
};

export type Scenario = 'base' | 'conservative' | 'optimistic';

export type VariableSpend = {
  /** Gasto variável médio por dia (≥ 0), que sai da conta. */
  dailyCents: Cents;
  /** Desvio-padrão do gasto variável mensal, para a faixa de incerteza. */
  monthlySigmaCents: Cents;
  /** Gasto variável no cartão: vira saída no vencimento, não no dia. Por data de vencimento. */
  cardDue?: { date: LocalDate; cents: Cents }[];
};

export type ProjectionInput = {
  start: LocalDate;
  startBalance: Cents;
  days: number;
  events: readonly CashEvent[];
  variable: VariableSpend;
  scenario?: Scenario;
};

export type ProjectionDay = {
  date: LocalDate;
  balance: Cents;
  low: Cents;
  high: Cents;
  inflow: Cents;
  outflow: Cents;
  events: CashEvent[];
};

export type Projection = {
  days: ProjectionDay[];
  min: { date: LocalDate; balance: Cents };
  minLow: { date: LocalDate; balance: Cents };
  negativeDays: number;
  firstNegative: LocalDate | null;
  end: Cents;
};

export const SCENARIO_FACTORS: Record<Scenario, { variable: number }> = {
  base: { variable: 1 },
  conservative: { variable: 1.15 },
  optimistic: { variable: 0.9 },
};

function eventValue(e: CashEvent, s: Scenario): Cents {
  if (s === 'conservative') return e.pessimisticCents ?? e.cents;
  if (s === 'optimistic') return e.optimisticCents ?? e.cents;
  return e.cents;
}

/**
 * Motor de projeção diária (função pura). O dia 0 é `start` (saldo atual + eventos de hoje); o
 * gasto variável começa no dia 1. A faixa soma a incerteza dos eventos estimados e a do gasto
 * variável (cresce com √t).
 */
export function project(input: ProjectionInput): Projection {
  const s = input.scenario ?? 'base';
  const factor = SCENARIO_FACTORS[s].variable;
  const end = addDays(input.start, input.days);
  const byDate = new Map<string, CashEvent[]>();
  const add = (e: CashEvent) => {
    const d = e.date < input.start ? input.start : e.date;
    if (d > end) return;
    byDate.set(d, [...(byDate.get(d) ?? []), e]);
  };
  input.events.forEach(add);
  for (const c of input.variable.cardDue ?? [])
    add({
      date: c.date,
      cents: -Math.round(c.cents * factor),
      pessimisticCents: -Math.round(c.cents * factor * 1.15),
      optimisticCents: -Math.round(c.cents * factor * 0.9),
      label: 'Gasto variável no cartão',
      kind: 'bill',
      estimated: true,
    });

  const days: ProjectionDay[] = [];
  let balance = input.startBalance;
  let downside = 0;
  let upside = 0;
  let variableAcc = 0;
  for (let i = 0; i <= input.days; i++) {
    const date = addDays(input.start, i);
    const evs = byDate.get(date) ?? [];
    let inflow = 0;
    let outflow = 0;
    for (const e of evs) {
      const v = eventValue(e, s);
      if (v >= 0) inflow += v;
      else outflow += v;
      downside += Math.max(0, v - (e.pessimisticCents ?? v));
      upside += Math.max(0, (e.optimisticCents ?? v) - v);
    }
    if (i > 0) {
      // Acumula em fração e só tira centavos inteiros: a soma de N dias bate com N × diário.
      const target = Math.round(input.variable.dailyCents * factor * i);
      outflow -= target - variableAcc;
      variableAcc = target;
    }
    balance += inflow + outflow;
    const sigma = Math.round(input.variable.monthlySigmaCents * Math.sqrt(i / 30));
    days.push({
      date,
      balance,
      low: balance - downside - sigma,
      high: balance + upside + sigma,
      inflow,
      outflow,
      events: evs,
    });
  }
  let min = days[0]!;
  let minLow = days[0]!;
  let negativeDays = 0;
  let firstNegative: LocalDate | null = null;
  for (const d of days) {
    if (d.balance < min.balance) min = d;
    if (d.low < minLow.low) minLow = d;
    if (d.balance < 0) {
      negativeDays++;
      firstNegative ??= d.date;
    }
  }
  return {
    days,
    min: { date: min.date, balance: min.balance },
    minLow: { date: minLow.date, balance: minLow.low },
    negativeDays,
    firstNegative,
    end: days[days.length - 1]!.balance,
  };
}

/**
 * "Livre para gastar por dia": quanto dá para gastar a mais, todo dia, até a próxima entrada de
 * renda sem que o saldo de nenhum dia fure a reserva mínima. Gastando `x` por dia, o saldo do
 * dia `t` cai `x·t`; logo `x = min_t (saldo_t − reserva) / t`.
 */
export function freePerDay(
  p: Projection,
  reserveCents: Cents,
  nextIncome: LocalDate | null,
): { cents: Cents; until: LocalDate; days: number; minBalance: Cents } {
  const start = p.days[0]!.date;
  const until = nextIncome && nextIncome > start ? nextIncome : addDays(start, 30);
  const window = p.days.filter((d) => d.date < until);
  const minBalance = Math.min(...window.map((d) => d.balance));
  const days = Math.max(1, diffDays(until, start));
  let x = window[0]!.balance >= reserveCents ? Number.POSITIVE_INFINITY : 0;
  for (let t = 1; t < window.length; t++) x = Math.min(x, (window[t]!.balance - reserveCents) / t);
  if (!Number.isFinite(x)) x = (window[0]!.balance - reserveCents) / days;
  return { cents: Math.max(0, Math.floor(x)), until, days, minBalance };
}
