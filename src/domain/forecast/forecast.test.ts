import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, type LocalDate } from '../dates/local-date';
import { detectRecurrences, type RecurrenceTx } from '../recurrence/detect';
import { canSpend, purchaseEvents } from './can-spend';
import {
  cashDateFor,
  installmentDrafts,
  plannedDrafts,
  recurringDates,
  recurringDrafts,
  splitInstallments,
  type AccountRef,
  type RecurringDef,
} from './drafts';
import {
  calibrationFactor,
  entryStatus,
  reconcile,
  scorePair,
  type MatchableEntry,
  type MatchableTx,
} from './match';
import { freePerDay, project, type CashEvent, type ProjectionInput } from './project';

const d = (s: string) => s as LocalDate;
const today = d('2026-10-16');
const card: AccountRef = { id: 'card', kind: 'credit_card', cycle: { closingDay: 3, dueDay: 10 } };
const checking: AccountRef = { id: 'acc', kind: 'checking', cycle: null };

const base = (over: Partial<ProjectionInput> = {}): ProjectionInput => ({
  start: today,
  startBalance: 500000,
  days: 60,
  events: [],
  variable: { dailyCents: 0, monthlySigmaCents: 0 },
  ...over,
});

describe('motor de projeção', () => {
  it('sem eventos e sem gasto variável, o saldo é constante', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 10_000_000 }),
        fc.integer({ min: 1, max: 120 }),
        (bal, days) => {
          const p = project(base({ startBalance: bal, days }));
          return p.days.every((x) => x.balance === bal && x.low === bal && x.high === bal);
        },
      ),
    );
  });

  const eventArb = fc.record({
    offset: fc.integer({ min: 0, max: 60 }),
    cents: fc.integer({ min: -500000, max: 500000 }),
  });

  it('somar uma despesa nunca aumenta o saldo de nenhum dia', () => {
    fc.assert(
      fc.property(
        fc.array(eventArb, { maxLength: 15 }),
        eventArb,
        fc.integer({ min: 0, max: 20000 }),
        (evs, extra, daily) => {
          const events: CashEvent[] = evs.map((e) => ({
            date: addDays(today, e.offset),
            cents: e.cents,
            label: 'x',
            kind: 'planned',
          }));
          const input = base({ events, variable: { dailyCents: daily, monthlySigmaCents: 0 } });
          const a = project(input);
          const b = project({
            ...input,
            events: [
              ...events,
              {
                date: addDays(today, extra.offset),
                cents: -Math.abs(extra.cents),
                label: 'y',
                kind: 'planned',
              },
            ],
          });
          return a.days.every((x, i) => b.days[i]!.balance <= x.balance);
        },
      ),
    );
  });

  it('a faixa sempre contém o cenário esperado', () => {
    fc.assert(
      fc.property(
        fc.array(eventArb, { maxLength: 10 }),
        fc.integer({ min: 0, max: 100000 }),
        (evs, sigma) => {
          const events: CashEvent[] = evs.map((e) => ({
            date: addDays(today, e.offset),
            cents: e.cents,
            pessimisticCents: e.cents - 1000,
            optimisticCents: e.cents + 1000,
            label: 'x',
            kind: 'income',
          }));
          const p = project(
            base({ events, variable: { dailyCents: 3000, monthlySigmaCents: sigma } }),
          );
          return p.days.every((x) => x.low <= x.balance && x.balance <= x.high);
        },
      ),
    );
  });

  it('gasto variável acumula exatamente N × diário', () => {
    const p = project(base({ days: 30, variable: { dailyCents: 3333, monthlySigmaCents: 0 } }));
    expect(p.end).toBe(500000 - 3333 * 30);
    expect(p.days[0]!.balance).toBe(500000);
  });

  it('eventos atrasados entram hoje; menor saldo e dias negativos', () => {
    const p = project(
      base({
        startBalance: 100000,
        events: [
          { date: d('2026-10-10'), cents: -20000, label: 'atrasado', kind: 'overdue' },
          { date: d('2026-10-20'), cents: -150000, label: 'aluguel', kind: 'recurring' },
          { date: d('2026-11-06'), cents: 500000, label: 'salário', kind: 'income' },
        ],
      }),
    );
    expect(p.days[0]!.balance).toBe(80000);
    expect(p.min).toEqual({ date: '2026-10-20', balance: -70000 });
    expect(p.firstNegative).toBe('2026-10-20');
    expect(p.negativeDays).toBe(17); // 20/10 a 05/11
  });

  it('cenário conservador usa o lado pessimista e gasta mais', () => {
    const input = base({
      events: [
        {
          date: d('2026-11-01'),
          cents: 300000,
          pessimisticCents: 250000,
          label: 'freela',
          kind: 'income',
        },
      ],
      variable: { dailyCents: 1000, monthlySigmaCents: 0 },
    });
    expect(project({ ...input, scenario: 'conservative' }).end).toBeLessThan(project(input).end);
  });

  it('livre por dia até o salário respeita a reserva em todos os dias', () => {
    const p = project(
      base({
        startBalance: 300000,
        events: [{ date: d('2026-10-26'), cents: -100000, label: 'conta', kind: 'recurring' }],
      }),
    );
    const f = freePerDay(p, 50000, d('2026-11-06'));
    expect(f.days).toBe(21);
    // dia 10 (26/10): 300.000 − 100.000 − 10x ≥ 50.000 → x ≤ 15.000; dia 20: 200.000 − 20x ≥ 50.000 → 7.500
    expect(f.cents).toBe(7500);
  });
});

describe('Posso gastar?', () => {
  const salary: CashEvent = {
    date: d('2026-11-06'),
    cents: 500000,
    label: 'salário',
    kind: 'income',
  };

  it('Pix que cabe: ✅', () => {
    const r = canSpend(
      base({ events: [salary] }),
      { amountCents: 100000, method: 'pix', installments: 1, date: today, account: checking },
      50000,
    );
    expect(r.verdict).toBe('ok');
    expect(r.after.min.balance).toBe(400000);
  });

  it('fura a reserva: ⚠️; fica negativo: ❌', () => {
    expect(
      canSpend(
        base({ events: [salary] }),
        { amountCents: 480000, method: 'pix', installments: 1, date: today, account: checking },
        50000,
      ).verdict,
    ).toBe('warn');
    const no = canSpend(
      base({ events: [salary] }),
      { amountCents: 600000, method: 'debit', installments: 1, date: today, account: checking },
      50000,
    );
    expect(no.verdict).toBe('no');
    expect(no.reasons[0]).toContain('negativo');
  });

  it('crédito parcelado vira saídas nos vencimentos das faturas', () => {
    const evs = purchaseEvents({
      amountCents: 100001,
      method: 'credit',
      installments: 3,
      date: today,
      account: card,
    });
    // compra em 16/10, fechamento dia 3 → fatura de 03/11 vence 10/11
    expect(evs.map((e) => [e.date, e.cents])).toEqual([
      ['2026-11-10', -33335],
      ['2026-12-10', -33333],
      ['2027-01-11', -33333], // 10/01/2027 é domingo
    ]);
    const r = canSpend(
      base(),
      { amountCents: 100001, method: 'credit', installments: 3, date: today, account: card },
      0,
    );
    expect(r.after.days.at(-1)!.date >= '2027-01-11').toBe(true);
    expect(r.reasons.join(' ')).toContain('parcelas');
  });
});

describe('ocorrências planejadas', () => {
  const rec = (over: Partial<RecurringDef> = {}): RecurringDef => ({
    id: 'r1',
    name: 'Aluguel',
    direction: 'out',
    account: checking,
    categoryId: null,
    descriptionNorm: 'ALUGUEL',
    amountCents: 200000,
    tolerancePct: 0.05,
    nature: 'fixed',
    periodicity: 'monthly',
    anchorDay: 31,
    anchorMonth: null,
    startDate: d('2026-01-01'),
    endDate: null,
    ...over,
  });

  it('mensal no dia 31 usa o último dia do mês', () => {
    expect(recurringDates(rec(), d('2026-10-01'), d('2026-12-31'))).toEqual([
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]);
  });

  it('semanal e anual', () => {
    expect(
      recurringDates(
        rec({ periodicity: 'weekly', anchorDay: 1 }),
        d('2026-10-16'),
        d('2026-10-31'),
      ),
    ).toEqual(['2026-10-19', '2026-10-26']);
    expect(
      recurringDates(
        rec({ periodicity: 'yearly', anchorDay: 15, anchorMonth: 2 }),
        d('2026-01-01'),
        d('2027-12-31'),
      ),
    ).toEqual(['2026-02-15', '2027-02-15']);
  });

  it('recorrente no cartão sai no vencimento', () => {
    const [x] = recurringDrafts(
      rec({ account: card, anchorDay: 20 }),
      d('2026-10-01'),
      d('2026-10-31'),
    );
    expect(x!.cashDate).toBe('2026-11-10');
    expect(cashDateFor(d('2026-10-02'), card)).toBe('2026-10-13'); // fatura de 03/10, vence 10/10 (sábado) + feriado 12/10
  });

  it('parcelas não perdem centavos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 24 }),
        (t, n) => {
          const parts = splitInstallments(t, n);
          return (
            parts.length === n &&
            parts.reduce((a, b) => a + b, 0) === t &&
            parts.every((p) => p >= 0)
          );
        },
      ),
    );
    expect(
      plannedDrafts({
        id: 'p',
        description: 'TV',
        amountCents: 300000,
        date: today,
        account: card,
        paymentMethod: 'credit',
        installments: 3,
        categoryId: null,
      }),
    ).toHaveLength(3);
  });

  it('parcelas futuras do cartão', () => {
    const [x] = installmentDrafts([
      {
        accountId: 'card',
        description: 'NOTEBOOK',
        number: 4,
        total: 10,
        amountCents: 30000,
        dueDate: d('2026-11-10'),
      },
    ]);
    expect(x!.cashDate).toBe('2026-11-10');
    expect(x!.label).toBe('NOTEBOOK (4/10)');
  });
});

describe('conciliação', () => {
  const entry = (over: Partial<MatchableEntry> = {}): MatchableEntry => ({
    id: 'e1',
    sourceType: 'income',
    direction: 'in',
    accountId: 'acc',
    expectedDate: d('2026-11-06'),
    windowStart: d('2026-11-03'),
    windowEnd: d('2026-11-13'),
    expectedCents: 497339,
    tolerancePct: 0.05,
    matchPattern: 'EMPRESA X',
    ...over,
  });
  const tx = (over: Partial<MatchableTx> = {}): MatchableTx => ({
    id: 't1',
    accountId: 'acc',
    date: d('2026-11-06'),
    amountCents: 497339,
    description: 'TED EMPRESA X LTDA SALARIO',
    kind: 'income',
    ...over,
  });

  it('casa salário no dia e valor exatos', () => {
    expect(reconcile([entry()], [tx()])).toEqual([
      expect.objectContaining({ entryId: 'e1', txId: 't1', deltaCents: 0 }),
    ]);
  });

  it('aceita diferença maior quando o pagador é o empregador', () => {
    expect(scorePair(entry(), tx({ amountCents: 530000 }))).not.toBeNull(); // +6,6%
    expect(scorePair(entry({ matchPattern: null }), tx({ amountCents: 530000 }))).toBeNull();
  });

  it('fora da janela, outra conta ou outro tipo: não casa', () => {
    expect(scorePair(entry(), tx({ date: d('2026-11-20') }))).toBeNull();
    expect(scorePair(entry(), tx({ accountId: 'outra' }))).toBeNull();
    expect(scorePair(entry(), tx({ kind: 'internal_transfer' }))).toBeNull();
  });

  it('nunca conta a mesma transação duas vezes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 28 }),
            cents: fc.integer({ min: 9000, max: 11000 }),
          }),
          { maxLength: 12 },
        ),
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 28 }),
            cents: fc.integer({ min: 9000, max: 11000 }),
          }),
          { maxLength: 12 },
        ),
        (es, ts) => {
          const entries = es.map((e, i) =>
            entry({
              id: `e${i}`,
              sourceType: 'recurring',
              direction: 'out',
              expectedDate: d(`2026-11-${String(e.day).padStart(2, '0')}`),
              windowStart: d('2026-11-01'),
              windowEnd: d('2026-11-30'),
              expectedCents: e.cents,
              tolerancePct: 0.1,
              matchPattern: 'NETFLIX',
            }),
          );
          const txs = ts.map((t, i) =>
            tx({
              id: `t${i}`,
              date: d(`2026-11-${String(t.day).padStart(2, '0')}`),
              amountCents: -t.cents,
              description: 'NETFLIX',
              kind: 'expense',
            }),
          );
          const m = reconcile(entries, txs);
          return (
            new Set(m.map((x) => x.txId)).size === m.length &&
            new Set(m.map((x) => x.entryId)).size === m.length
          );
        },
      ),
    );
  });

  it('respeita pares já casados e os que o usuário desfez', () => {
    expect(reconcile([entry()], [tx()], { matchedTxIds: new Set(['t1']) })).toEqual([]);
    expect(reconcile([entry()], [tx()], { rejectedPairs: new Set(['e1|t1']) })).toEqual([]);
  });

  it('situação: realizado, atrasado, previsto', () => {
    const e = { windowEnd: d('2026-11-13'), status: 'previsto' as const };
    expect(entryStatus(e, true, d('2026-11-20'))).toBe('realizado');
    expect(entryStatus(e, false, d('2026-11-20'))).toBe('atrasado');
    expect(entryStatus(e, false, d('2026-11-10'))).toBe('previsto');
    expect(entryStatus({ ...e, status: 'cancelado' }, false, d('2026-11-20'))).toBe('cancelado');
  });

  it('calibração pela mediana, limitada', () => {
    expect(calibrationFactor([])).toBe(1);
    expect(
      calibrationFactor([
        { expectedCents: 100, actualCents: 102 },
        { expectedCents: 100, actualCents: 104 },
        { expectedCents: 100, actualCents: 103 },
      ]),
    ).toBe(1.03);
    expect(calibrationFactor([{ expectedCents: 100, actualCents: 300 }])).toBe(1.25);
  });
});

describe('detecção de recorrências', () => {
  const monthly = (
    desc: string,
    day: number,
    cents: number,
    months: number,
    jitter = 0,
  ): RecurrenceTx[] =>
    Array.from({ length: months }, (_, i) => {
      const m = 10 - months + i + 1; // termina em outubro/2026
      const y = m <= 0 ? 2025 : 2026;
      const mm = m <= 0 ? m + 12 : m;
      return {
        id: `${desc}${i}`,
        accountId: 'acc',
        date: d(`${y}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`),
        amountCents: -(cents + (i % 2 ? jitter : 0)),
        descriptionNorm: desc,
        categoryId: 'cat',
      };
    });

  it('assinatura mensal de valor fixo', () => {
    const [s] = detectRecurrences(monthly('NETFLIX', 5, 5590, 6), today);
    expect(s).toMatchObject({
      periodicity: 'monthly',
      anchorDay: 5,
      amountCents: 5590,
      nature: 'fixed',
      direction: 'out',
    });
  });

  it('conta de valor variável', () => {
    const [s] = detectRecurrences(monthly('ENEL', 12, 20000, 6, 4000), today);
    expect(s!.nature).toBe('variable');
    expect(s!.tolerancePct).toBeGreaterThan(0.05);
  });

  it('não sugere o que parou, nem com poucas ocorrências, nem o irregular', () => {
    expect(
      detectRecurrences(
        monthly('ACADEMIA', 5, 9990, 6).map((t) => ({ ...t, date: addDays(t.date, -150) })),
        today,
      ),
    ).toEqual([]);
    expect(detectRecurrences(monthly('SPOTIFY', 5, 2190, 2), today)).toEqual([]);
    const irregular: RecurrenceTx[] = [
      '2026-03-01',
      '2026-03-04',
      '2026-05-30',
      '2026-06-02',
      '2026-09-28',
    ].map((x, i) => ({
      id: `i${i}`,
      accountId: 'acc',
      date: d(x),
      amountCents: -1000,
      descriptionNorm: 'PADARIA',
      categoryId: null,
    }));
    expect(detectRecurrences(irregular, today)).toEqual([]);
  });
});
