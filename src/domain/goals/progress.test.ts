import { describe, expect, it } from 'vitest';
import { localDate } from '../dates/local-date';
import { emergencyCoverage, goalProgress } from './progress';

const d = localDate;

describe('goalProgress', () => {
  it('meta atingida', () => {
    expect(
      goalProgress({
        targetCents: 1000,
        savedCents: 1500,
        createdOn: d('2026-01-01'),
        targetDate: null,
        today: d('2026-10-17'),
      }).status,
    ).toBe('done');
  });

  it('calcula quanto guardar por mês e se está no ritmo', () => {
    const p = goalProgress({
      targetCents: 1_200_000,
      savedCents: 300_000,
      createdOn: d('2026-01-01'),
      targetDate: d('2027-01-01'),
      today: d('2026-07-02'),
    });
    expect(p.status).toBe('behind'); // metade do prazo, 25% guardado
    expect(p.monthsLeft).toBe(7);
    expect(p.monthlyNeededCents).toBe(Math.ceil(900_000 / 7));
    expect(p.ratio).toBe(0.25);
  });

  it('sem data não cobra ritmo', () => {
    const p = goalProgress({
      targetCents: 1000,
      savedCents: 100,
      createdOn: d('2026-01-01'),
      targetDate: null,
      today: d('2026-02-01'),
    });
    expect(p.status).toBe('no_date');
    expect(p.monthlyNeededCents).toBeNull();
  });
});

describe('emergencyCoverage', () => {
  it('meses cobertos e o que falta', () => {
    expect(emergencyCoverage(1_500_000, 500_000, 6)).toEqual({
      months: 3,
      targetCents: 3_000_000,
      missingCents: 1_500_000,
      ratio: 0.5,
    });
  });
});
