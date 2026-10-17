import { diffDays, type LocalDate } from '../dates/local-date';
import type { Cents } from '../money';

export type GoalStatus = 'done' | 'on_track' | 'behind' | 'no_date';

export type GoalProgress = {
  savedCents: Cents;
  remainingCents: Cents;
  ratio: number;
  monthsLeft: number | null;
  /** Quanto guardar por mês (sem contar rendimento) para chegar na data. */
  monthlyNeededCents: Cents | null;
  status: GoalStatus;
};

/**
 * Progresso de uma meta. "No ritmo" compara o guardado com a reta entre a criação e a data-alvo.
 */
export function goalProgress(g: {
  targetCents: Cents;
  savedCents: Cents;
  createdOn: LocalDate;
  targetDate: LocalDate | null;
  today: LocalDate;
}): GoalProgress {
  const saved = Math.max(0, g.savedCents);
  const remaining = Math.max(0, g.targetCents - saved);
  const ratio = g.targetCents > 0 ? Math.min(1, saved / g.targetCents) : 1;
  if (remaining === 0)
    return {
      savedCents: saved,
      remainingCents: 0,
      ratio: 1,
      monthsLeft: 0,
      monthlyNeededCents: 0,
      status: 'done',
    };
  if (!g.targetDate)
    return {
      savedCents: saved,
      remainingCents: remaining,
      ratio,
      monthsLeft: null,
      monthlyNeededCents: null,
      status: 'no_date',
    };
  const daysLeft = diffDays(g.targetDate, g.today);
  const monthsLeft = Math.max(0, Math.ceil(daysLeft / 30.44));
  const total = Math.max(1, diffDays(g.targetDate, g.createdOn));
  const elapsed = Math.min(total, Math.max(0, diffDays(g.today, g.createdOn)));
  const expected = (g.targetCents * elapsed) / total;
  return {
    savedCents: saved,
    remainingCents: remaining,
    ratio,
    monthsLeft,
    monthlyNeededCents: monthsLeft > 0 ? Math.ceil(remaining / monthsLeft) : remaining,
    status: saved + 1 >= expected ? 'on_track' : 'behind',
  };
}

/** Reserva de emergência: meses cobertos pelo dinheiro disponível, dado o custo mensal essencial. */
export function emergencyCoverage(
  liquidCents: Cents,
  monthlyEssentialCents: Cents,
  targetMonths: number,
) {
  const months = monthlyEssentialCents > 0 ? liquidCents / monthlyEssentialCents : Infinity;
  const targetCents = monthlyEssentialCents * targetMonths;
  return {
    months,
    targetCents,
    missingCents: Math.max(0, targetCents - liquidCents),
    ratio: targetCents > 0 ? Math.min(1, liquidCents / targetCents) : 1,
  };
}
