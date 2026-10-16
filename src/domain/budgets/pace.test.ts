import { describe, expect, it } from 'vitest';
import { budgetPace, rolloverCents } from './pace';

describe('ritmo do orçamento', () => {
  it('projeta o fim do mês no ritmo atual', () => {
    const r = budgetPace({ amountCents: 100000, spentCents: 50000, day: 10, daysInMonth: 30 });
    expect(r.projectedCents).toBe(150000);
    expect(r.status).toBe('warning'); // ainda em 50%, mas o ritmo estoura
    expect(r.thresholdsCrossed).toEqual([]);
  });

  it('alerta aos 80% e 100%', () => {
    expect(
      budgetPace({ amountCents: 100000, spentCents: 80000, day: 28, daysInMonth: 30 })
        .thresholdsCrossed,
    ).toEqual([80]);
    const r = budgetPace({ amountCents: 100000, spentCents: 120000, day: 30, daysInMonth: 30 });
    expect(r).toMatchObject({
      status: 'exceeded',
      thresholdsCrossed: [80, 100],
      remainingCents: -20000,
    });
  });

  it('sobra do mês anterior aumenta o limite', () => {
    expect(
      budgetPace({
        amountCents: 100000,
        rolledInCents: 20000,
        spentCents: 100000,
        day: 30,
        daysInMonth: 30,
      }).status,
    ).toBe('warning');
  });

  it('rollover só com a opção ligada e nunca negativo', () => {
    expect(
      rolloverCents({ amountCents: 100000, rolledInCents: 0, spentCents: 70000, rollover: true }),
    ).toBe(30000);
    expect(
      rolloverCents({ amountCents: 100000, rolledInCents: 0, spentCents: 130000, rollover: true }),
    ).toBe(0);
    expect(
      rolloverCents({ amountCents: 100000, rolledInCents: 0, spentCents: 70000, rollover: false }),
    ).toBe(0);
  });

  it('orçamento zero com gasto é estouro', () => {
    expect(budgetPace({ amountCents: 0, spentCents: 100, day: 1, daysInMonth: 30 }).status).toBe(
      'exceeded',
    );
  });
});
