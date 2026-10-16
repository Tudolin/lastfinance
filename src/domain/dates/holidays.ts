import { addDays, ymd, type LocalDate } from './local-date';

export type Holiday = { date: LocalDate; name: string; kind: 'national' | 'banking' };

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): LocalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(year, month, day);
}

/**
 * Feriados que fecham o sistema bancário em todo o país.
 * - Nacionais (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023 — Consciência Negra desde 2024).
 * - Bancários (calendário FEBRABAN): Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi.
 */
export function nationalHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const list: Holiday[] = [
    { date: ymd(year, 1, 1), name: 'Confraternização Universal', kind: 'national' },
    { date: addDays(easter, -48), name: 'Carnaval (segunda)', kind: 'banking' },
    { date: addDays(easter, -47), name: 'Carnaval (terça)', kind: 'banking' },
    { date: addDays(easter, -2), name: 'Sexta-feira Santa', kind: 'national' },
    { date: ymd(year, 4, 21), name: 'Tiradentes', kind: 'national' },
    { date: ymd(year, 5, 1), name: 'Dia do Trabalho', kind: 'national' },
    { date: addDays(easter, 60), name: 'Corpus Christi', kind: 'banking' },
    { date: ymd(year, 9, 7), name: 'Independência', kind: 'national' },
    { date: ymd(year, 10, 12), name: 'Nossa Senhora Aparecida', kind: 'national' },
    { date: ymd(year, 11, 2), name: 'Finados', kind: 'national' },
    { date: ymd(year, 11, 15), name: 'Proclamação da República', kind: 'national' },
    { date: ymd(year, 12, 25), name: 'Natal', kind: 'national' },
  ];
  if (year >= 2024) {
    list.push({
      date: ymd(year, 11, 20),
      name: 'Dia Nacional de Zumbi e da Consciência Negra',
      kind: 'national',
    });
  }
  return list.sort((a, b) => (a.date < b.date ? -1 : 1));
}
