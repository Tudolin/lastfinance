import type { Cents } from '../money';

export type Nature = 'fixed' | 'variable_recurring' | 'eventual';

export const NATURE_LABEL: Record<Nature, string> = {
  fixed: 'Fixa',
  variable_recurring: 'Variável recorrente',
  eventual: 'Eventual',
};

/** Gasto (positivo) de um grupo — estabelecimento ou categoria — em um mês 'YYYY-MM'. */
export type MonthlyPoint = { month: string; cents: Cents; count: number };

export type GroupStats = {
  nature: Nature;
  monthsPresent: number;
  monthsObserved: number;
  /** média mensal considerando só os meses em que houve gasto */
  meanCents: Cents;
  minCents: Cents;
  maxCents: Cents;
  /** coeficiente de variação dos meses presentes */
  cv: number;
  /** média mensal (incluindo meses sem gasto) nos últimos 3, 6 e 12 meses */
  avg3: Cents;
  avg6: Cents;
  avg12: Cents;
  /** variação da média dos últimos 3 meses contra os 3 anteriores (null sem base) */
  trend3: number | null;
};

export const NATURE_PARAMS = {
  fixedMinPresence: 0.75,
  fixedMaxCv: 0.1,
  recurringMinPresence: 0.5,
  minMonthsForRecurring: 3,
} as const;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Classifica um grupo de gastos em fixa / variável recorrente / eventual com base estatística
 * (presença mensal e dispersão do valor). A IA só dá nome e explica; quem decide é este código.
 *
 * @param months todos os meses observados, em ordem crescente ('YYYY-MM'), terminando no mês mais recente completo
 */
export function analyzeGroup(
  points: readonly MonthlyPoint[],
  months: readonly string[],
): GroupStats {
  const byMonth = new Map(points.map((p) => [p.month, p]));
  const series = months.map((m) => byMonth.get(m)?.cents ?? 0);
  const present = series.filter((v) => v > 0);
  const counts = months.map((m) => byMonth.get(m)?.count ?? 0).filter((c) => c > 0);
  const mean = avg(present);
  const std = present.length > 1 ? Math.sqrt(avg(present.map((v) => (v - mean) ** 2))) : 0;
  const cv = mean > 0 ? std / mean : 0;
  const presence = months.length ? present.length / months.length : 0;
  const onceAMonth = counts.length > 0 && avg(counts) <= 1.34;

  let nature: Nature = 'eventual';
  if (
    present.length >= NATURE_PARAMS.minMonthsForRecurring &&
    presence >= NATURE_PARAMS.recurringMinPresence
  ) {
    nature =
      presence >= NATURE_PARAMS.fixedMinPresence && cv <= NATURE_PARAMS.fixedMaxCv && onceAMonth
        ? 'fixed'
        : 'variable_recurring';
  }

  const lastN = (n: number) => Math.round(avg(series.slice(-n)));
  const last3 = avg(series.slice(-3));
  const prev3 = series.length >= 6 ? avg(series.slice(-6, -3)) : null;
  return {
    nature,
    monthsPresent: present.length,
    monthsObserved: months.length,
    meanCents: Math.round(mean),
    minCents: present.length ? Math.min(...present) : 0,
    maxCents: present.length ? Math.max(...present) : 0,
    cv: Math.round(cv * 1000) / 1000,
    avg3: lastN(3),
    avg6: lastN(6),
    avg12: lastN(12),
    trend3: prev3 && prev3 > 0 ? Math.round(((last3 - prev3) / prev3) * 1000) / 1000 : null,
  };
}

/** Lista de meses 'YYYY-MM' de `from` até `to` (inclusive). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
