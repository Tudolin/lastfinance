import { nationalHolidays } from './holidays';
import {
  addDays,
  dayOfWeek,
  daysInMonth,
  diffDays,
  parts,
  ymd,
  type LocalDate,
} from './local-date';

export type CalendarOptions = {
  /**
   * Para prazo de salário CLT (art. 459), o sábado conta como dia útil
   * (entendimento do MTE). Para compensação bancária, não conta.
   */
  saturdayIsBusinessDay?: boolean;
  /** Feriados extras (estaduais/municipais) cadastrados pelo usuário. */
  extraHolidays?: readonly LocalDate[];
};

export class BusinessCalendar {
  private readonly holidayCache = new Map<number, Set<string>>();
  private readonly extra: Set<string>;
  readonly saturdayIsBusinessDay: boolean;

  constructor(opts: CalendarOptions = {}) {
    this.saturdayIsBusinessDay = opts.saturdayIsBusinessDay ?? false;
    this.extra = new Set(opts.extraHolidays ?? []);
  }

  private holidays(year: number): Set<string> {
    let s = this.holidayCache.get(year);
    if (!s) {
      s = new Set(nationalHolidays(year).map((h) => h.date));
      this.holidayCache.set(year, s);
    }
    return s;
  }

  isHoliday(d: LocalDate): boolean {
    return this.extra.has(d) || this.holidays(parts(d).year).has(d);
  }

  isBusinessDay(d: LocalDate): boolean {
    const dow = dayOfWeek(d);
    if (dow === 0) return false;
    if (dow === 6 && !this.saturdayIsBusinessDay) return false;
    return !this.isHoliday(d);
  }

  /** O próprio dia, se útil; senão o próximo dia útil. */
  nextOrSame(d: LocalDate): LocalDate {
    let cur = d;
    while (!this.isBusinessDay(cur)) cur = addDays(cur, 1);
    return cur;
  }

  /** O próprio dia, se útil; senão o dia útil anterior. */
  previousOrSame(d: LocalDate): LocalDate {
    let cur = d;
    while (!this.isBusinessDay(cur)) cur = addDays(cur, -1);
    return cur;
  }

  /** Desloca `n` dias úteis (n pode ser negativo). n = 0 devolve nextOrSame. */
  addBusinessDays(d: LocalDate, n: number): LocalDate {
    if (n === 0) return this.nextOrSame(d);
    const step = n > 0 ? 1 : -1;
    let cur = d;
    let left = Math.abs(n);
    while (left > 0) {
      cur = addDays(cur, step);
      if (this.isBusinessDay(cur)) left--;
    }
    return cur;
  }

  /** N-ésimo dia útil do mês (1 = primeiro). */
  nthBusinessDay(year: number, month: number, n: number): LocalDate {
    if (n < 1) throw new RangeError('n deve ser >= 1');
    let count = 0;
    const last = daysInMonth(year, month);
    for (let day = 1; day <= last; day++) {
      const d = ymd(year, month, day);
      if (this.isBusinessDay(d) && ++count === n) return d;
    }
    throw new RangeError(`O mês ${month}/${year} não tem ${n} dias úteis`);
  }

  lastBusinessDay(year: number, month: number): LocalDate {
    return this.previousOrSame(ymd(year, month, daysInMonth(year, month)));
  }

  /**
   * Distância em dias úteis entre duas datas (|a − b|), contando os dias úteis
   * percorridos depois da menor data até a maior inclusive.
   */
  businessDaysBetween(a: LocalDate, b: LocalDate): number {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    let count = 0;
    const span = diffDays(hi, lo);
    for (let i = 1; i <= span; i++) if (this.isBusinessDay(addDays(lo, i))) count++;
    return count;
  }
}

export const bankingCalendar = new BusinessCalendar();
