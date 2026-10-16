import { describe, expect, it } from 'vitest';
import { BusinessCalendar } from '../dates/business-days';
import { localDate as d } from '../dates/local-date';
import {
  assignToKnownBill,
  cashDateForDue,
  cycleForPurchase,
  inferCycleConfig,
  shiftCycle,
} from './billing-cycle';

const nubank = { closingDay: 3, dueDay: 10 };
const lateClose = { closingDay: 28, dueDay: 5 };

describe('ciclo da fatura', () => {
  it('compra antes do fechamento entra na fatura do mês', () => {
    expect(cycleForPurchase(d('2026-10-02'), nubank)).toEqual({
      closingDate: '2026-10-03',
      dueDate: '2026-10-10',
    });
  });

  it('compra NO dia do fechamento vai para a fatura seguinte', () => {
    expect(cycleForPurchase(d('2026-10-03'), nubank)).toEqual({
      closingDate: '2026-11-03',
      dueDate: '2026-11-10',
    });
  });

  it('vencimento no mês seguinte quando dueDay ≤ closingDay', () => {
    expect(cycleForPurchase(d('2026-10-20'), lateClose)).toEqual({
      closingDate: '2026-10-28',
      dueDate: '2026-11-05',
    });
    expect(cycleForPurchase(d('2026-12-29'), lateClose)).toEqual({
      closingDate: '2027-01-28',
      dueDate: '2027-02-05',
    });
  });

  it('fechamento no dia 31 em mês curto', () => {
    const cfg = { closingDay: 31, dueDay: 8 };
    expect(cycleForPurchase(d('2026-02-27'), cfg).closingDate).toBe('2026-02-28');
    expect(cycleForPurchase(d('2026-02-28'), cfg).closingDate).toBe('2026-03-31');
  });

  it('parcelas futuras caem nos ciclos seguintes', () => {
    const c1 = cycleForPurchase(d('2026-10-20'), nubank);
    expect(c1.dueDate).toBe('2026-11-10');
    expect(shiftCycle(c1, 2, nubank).dueDate).toBe('2027-01-10');
    expect(shiftCycle(c1, 9, nubank).dueDate).toBe('2027-08-10');
  });

  it('atribui a faturas reais pelo fechamento', () => {
    const bills = [
      { id: 'set', closingDate: d('2026-09-03'), dueDate: d('2026-09-10') },
      { id: 'out', closingDate: d('2026-10-03'), dueDate: d('2026-10-10') },
      { id: 'nov', closingDate: d('2026-11-03'), dueDate: d('2026-11-10') },
    ];
    expect(assignToKnownBill(d('2026-09-15'), bills)?.id).toBe('out');
    expect(assignToKnownBill(d('2026-10-03'), bills)?.id).toBe('nov');
    expect(assignToKnownBill(d('2026-11-03'), bills)).toBeNull();
  });

  it('infere fechamento e vencimento pela moda', () => {
    expect(
      inferCycleConfig([
        { closingDate: d('2026-08-03'), dueDate: d('2026-08-10') },
        { closingDate: d('2026-09-03'), dueDate: d('2026-09-10') },
        { closingDate: d('2026-10-05'), dueDate: d('2026-10-12') },
      ]),
    ).toEqual({ closingDay: 3, dueDay: 10 });
    expect(inferCycleConfig([])).toBeNull();
  });

  it('vencimento em dia não útil é pago no próximo dia útil', () => {
    expect(cashDateForDue(d('2026-10-10'), new BusinessCalendar())).toBe('2026-10-13');
  });
});
