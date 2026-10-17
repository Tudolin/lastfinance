import { describe, expect, it } from 'vitest';
import { localDate } from '../dates/local-date';
import { project } from '../forecast/project';
import { changeEvents, scenarioChangeSchema } from './changes';

const until = localDate('2027-12-31');
const parse = (x: unknown) => scenarioChangeSchema.parse(x);

describe('changeEvents', () => {
  it('financiamento do carro: entrada no contrato e parcelas mensais', () => {
    const { events, financing } = changeEvents(
      parse({
        type: 'financing',
        assetPrice: 70000,
        downPayment: 10000,
        monthlyRatePct: 1.5,
        months: 48,
        contractDate: '2026-12-10',
        iof: false,
      }),
      until,
    );
    expect(events[0]).toMatchObject({ date: '2026-12-10', cents: -1_000_000 });
    expect(events[1]).toMatchObject({ date: '2027-01-10', cents: -176_250 });
    expect(events).toHaveLength(1 + 12); // até dez/2027
    expect(financing!.installments).toHaveLength(48);
  });

  it('recorrente respeita o dia do mês (31 vira o último dia) e o número de meses', () => {
    const { events } = changeEvents(
      parse({ type: 'recurring', amount: 100, start: '2027-01-31', months: 3 }),
      until,
    );
    expect(events.map((e) => e.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(events.every((e) => e.cents === -10_000)).toBe(true);
  });

  it('parcelado no cartão soma exatamente o total', () => {
    const { events } = changeEvents(
      parse({
        type: 'card_installments',
        amount: 1000,
        installments: 3,
        firstDueDate: '2027-01-05',
      }),
      until,
    );
    expect(events.reduce((s, e) => s + e.cents, 0)).toBe(-100_000);
  });

  it('somar uma saída nunca aumenta o saldo projetado em nenhum dia', () => {
    const input = {
      start: localDate('2026-12-01'),
      startBalance: 500_000,
      days: 120,
      events: [],
      variable: { dailyCents: 1000, monthlySigmaCents: 0 },
    };
    const base = project(input);
    const { events } = changeEvents(
      parse({ type: 'one_off', amount: 800, date: '2027-01-15' }),
      until,
    );
    const after = project({ ...input, events });
    after.days.forEach((d, i) => expect(d.balance).toBeLessThanOrEqual(base.days[i]!.balance));
    expect(after.end).toBe(base.end - 80_000);
  });
});
