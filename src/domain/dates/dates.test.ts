import { describe, expect, it } from 'vitest';
import { BusinessCalendar } from './business-days';
import { easterSunday, nationalHolidays } from './holidays';
import {
  addMonths,
  clampedDate,
  dayOfWeek,
  diffDays,
  endOfMonth,
  formatBR,
  isLocalDate,
  localDate as d,
  toLocalDateSP,
} from './local-date';

describe('LocalDate', () => {
  it('valida datas reais', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('16/10/2026')).toBe(false);
  });

  it('soma meses limitando ao último dia', () => {
    expect(addMonths(d('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addMonths(d('2028-01-31'), 1)).toBe('2028-02-29');
    expect(addMonths(d('2026-12-15'), 1)).toBe('2027-01-15');
    expect(addMonths(d('2026-03-31'), -1)).toBe('2026-02-28');
    expect(clampedDate(2026, 4, 31)).toBe('2026-04-30');
    expect(endOfMonth(d('2026-02-10'))).toBe('2026-02-28');
  });

  it('calcula diferença de dias e dia da semana', () => {
    expect(diffDays(d('2026-03-01'), d('2026-02-01'))).toBe(28);
    expect(dayOfWeek(d('2026-10-16'))).toBe(5); // sexta
  });

  it('converte instantes para a data em São Paulo (UTC−3)', () => {
    expect(toLocalDateSP('2026-10-17T02:30:00Z')).toBe('2026-10-16');
    expect(toLocalDateSP('2026-10-17T03:30:00Z')).toBe('2026-10-17');
  });

  it('formata no padrão brasileiro', () => {
    expect(formatBR(d('2026-01-05'))).toBe('05/01/2026');
  });
});

describe('feriados', () => {
  it('calcula a Páscoa', () => {
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });

  it('inclui feriados móveis bancários e a Consciência Negra a partir de 2024', () => {
    const h2026 = nationalHolidays(2026).map((h) => h.date);
    expect(h2026).toContain('2026-02-16'); // carnaval segunda
    expect(h2026).toContain('2026-02-17'); // carnaval terça
    expect(h2026).toContain('2026-04-03'); // sexta-feira santa
    expect(h2026).toContain('2026-06-04'); // corpus christi
    expect(h2026).toContain('2026-11-20');
    expect(nationalHolidays(2023).map((h) => h.date)).not.toContain('2023-11-20');
  });
});

describe('BusinessCalendar', () => {
  const bank = new BusinessCalendar();
  const clt = new BusinessCalendar({ saturdayIsBusinessDay: true });

  it('pula fim de semana e feriado', () => {
    expect(bank.isBusinessDay(d('2026-10-12'))).toBe(false); // Aparecida (segunda)
    expect(bank.nextOrSame(d('2026-10-10'))).toBe('2026-10-13'); // sábado → terça
    expect(bank.previousOrSame(d('2026-10-12'))).toBe('2026-10-09');
  });

  it('5º dia útil bancário de novembro/2026 (feriado dia 2)', () => {
    // nov/2026: 1 dom, 2 seg (Finados), 3 ter, 4 qua, 5 qui, 6 sex, 9 seg
    expect(bank.nthBusinessDay(2026, 11, 1)).toBe('2026-11-03');
    expect(bank.nthBusinessDay(2026, 11, 5)).toBe('2026-11-09');
  });

  it('5º dia útil CLT conta sábado', () => {
    // 3 ter, 4 qua, 5 qui, 6 sex, 7 sáb
    expect(clt.nthBusinessDay(2026, 11, 5)).toBe('2026-11-07');
  });

  it('mês que começa no sábado', () => {
    // ago/2026 começa no sábado
    expect(bank.nthBusinessDay(2026, 8, 1)).toBe('2026-08-03');
  });

  it('último dia útil de dezembro e de um mês terminando em domingo', () => {
    expect(bank.lastBusinessDay(2026, 12)).toBe('2026-12-31');
    expect(bank.lastBusinessDay(2026, 5)).toBe('2026-05-29'); // 31/05 domingo
  });

  it('desloca dias úteis para frente e para trás', () => {
    expect(bank.addBusinessDays(d('2026-10-09'), 1)).toBe('2026-10-13');
    expect(bank.addBusinessDays(d('2026-10-13'), -1)).toBe('2026-10-09');
    expect(bank.addBusinessDays(d('2026-10-10'), 0)).toBe('2026-10-13');
  });

  it('conta dias úteis entre datas, em qualquer ordem', () => {
    expect(bank.businessDaysBetween(d('2026-10-09'), d('2026-10-13'))).toBe(1);
    expect(bank.businessDaysBetween(d('2026-10-13'), d('2026-10-09'))).toBe(1);
    expect(bank.businessDaysBetween(d('2026-10-14'), d('2026-10-14'))).toBe(0);
  });

  it('respeita feriados extras', () => {
    const sp = new BusinessCalendar({ extraHolidays: [d('2026-01-25')] }); // aniversário de SP (domingo em 2026)
    expect(sp.isHoliday(d('2026-01-25'))).toBe(true);
  });

  it('rejeita n impossível', () => {
    expect(() => bank.nthBusinessDay(2026, 2, 25)).toThrow();
  });
});
