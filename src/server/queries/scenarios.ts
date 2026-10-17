import 'server-only';
import { addDays, endOfMonth, todaySP } from '@/domain/dates/local-date';
import { project, type CashEvent, type Projection } from '@/domain/forecast/project';
import { changeEvents, type ScenarioChange } from '@/domain/scenarios/changes';
import type { FinancingResult } from '@/domain/scenarios/financing';
import { requireUnlocked } from '@/server/auth/request';
import { buildProjectionContext } from '@/server/services/planning';

/** Saldo no último dia de cada mês do horizonte. */
function monthEnds(p: Projection) {
  return p.days
    .filter((d, i) => d.date === endOfMonth(d.date) || i === p.days.length - 1)
    .map((d) => ({ date: d.date, balance: d.balance }));
}

/**
 * Aplica mudanças hipotéticas à previsão de caixa (sem gravar nada) e compara com a previsão atual.
 * Horizonte de até 365 dias (o mesmo dos previstos gerados).
 */
export async function simulateScenario(changes: ScenarioChange[], days = 365) {
  await requireUnlocked();
  const today = todaySP();
  const horizon = Math.min(365, Math.max(30, days));
  const ctx = await buildProjectionContext(horizon, today);
  const until = addDays(today, horizon);
  const extra: CashEvent[] = [];
  const financings: (FinancingResult & { label: string })[] = [];
  for (const c of changes) {
    const r = changeEvents(c, until);
    extra.push(...r.events);
    if (r.financing) financings.push({ ...r.financing, label: c.label });
  }
  const before = project(ctx.input);
  const after = project({ ...ctx.input, events: [...ctx.input.events, ...extra] });
  const afterConservative = project({
    ...ctx.input,
    events: [...ctx.input.events, ...extra],
    scenario: 'conservative',
  });
  const verdict =
    after.min.balance < 0 ? 'no' : after.min.balance < ctx.reserveCents ? 'warn' : 'ok';
  const pastToday = extra.filter((e) => e.date < today).length;
  return {
    today,
    horizonDays: horizon,
    verdict,
    reserveCents: ctx.reserveCents,
    ignoredPastEvents: pastToday,
    before: {
      min: before.min,
      end: before.end,
      negativeDays: before.negativeDays,
      firstNegative: before.firstNegative,
    },
    after: {
      min: after.min,
      end: after.end,
      negativeDays: after.negativeDays,
      firstNegative: after.firstNegative,
    },
    afterConservativeMin: afterConservative.min,
    monthEnds: monthEnds(before).map((b, i) => ({
      date: b.date,
      before: b.balance,
      after: monthEnds(after)[i]?.balance ?? null,
    })),
    series: before.days.map((d, i) => ({
      date: d.date,
      before: d.balance,
      after: after.days[i]?.balance ?? d.balance,
    })),
    financings,
  };
}
