import type { Cents } from '../money';

export type BudgetStatus = 'ok' | 'warning' | 'exceeded';

export type BudgetPace = {
  limitCents: Cents;
  spentCents: Cents;
  remainingCents: Cents;
  usedRatio: number;
  /** projeção linear para o fim do mês no ritmo atual */
  projectedCents: Cents;
  status: BudgetStatus;
  /** alertas que deveriam disparar (80% e 100%) */
  thresholdsCrossed: (80 | 100)[];
};

/**
 * Ritmo do orçamento. `day`/`daysInMonth` em dias corridos; para o mês fechado use day = daysInMonth.
 * Limite = valor do mês + sobra trazida do mês anterior (se houver).
 */
export function budgetPace(p: {
  amountCents: Cents;
  rolledInCents?: Cents;
  spentCents: Cents;
  day: number;
  daysInMonth: number;
}): BudgetPace {
  const limit = p.amountCents + (p.rolledInCents ?? 0);
  const spent = Math.max(0, p.spentCents);
  const day = Math.min(Math.max(1, p.day), p.daysInMonth);
  const projected = Math.round((spent / day) * p.daysInMonth);
  const ratio = limit > 0 ? spent / limit : spent > 0 ? Infinity : 0;
  const thresholds: (80 | 100)[] = [];
  if (ratio >= 0.8) thresholds.push(80);
  if (ratio >= 1) thresholds.push(100);
  return {
    limitCents: limit,
    spentCents: spent,
    remainingCents: limit - spent,
    usedRatio: Number.isFinite(ratio) ? Math.round(ratio * 1000) / 1000 : ratio,
    projectedCents: projected,
    status: ratio >= 1 ? 'exceeded' : ratio >= 0.8 || projected > limit ? 'warning' : 'ok',
    thresholdsCrossed: thresholds,
  };
}

/** Sobra que passa para o mês seguinte (só se o orçamento tiver rollover e não estourou). */
export function rolloverCents(p: {
  amountCents: Cents;
  rolledInCents: Cents;
  spentCents: Cents;
  rollover: boolean;
}): Cents {
  if (!p.rollover) return 0;
  return Math.max(0, p.amountCents + p.rolledInCents - Math.max(0, p.spentCents));
}
