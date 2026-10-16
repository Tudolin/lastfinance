/**
 * Data de calendário sem hora nem fuso ("2026-10-16").
 * Toda regra de negócio (competência, vencimento, dia útil) usa LocalDate,
 * para não sofrer com fuso horário nem horário de verão.
 */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isLocalDate(s: string): s is LocalDate {
  const m = RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function localDate(s: string): LocalDate {
  if (!isLocalDate(s)) throw new RangeError(`Data inválida: ${s}`);
  return s;
}

export function ymd(year: number, month: number, day: number): LocalDate {
  return fromEpochDay(Math.floor(Date.UTC(year, month - 1, day) / DAY_MS));
}

export function parts(d: LocalDate): { year: number; month: number; day: number } {
  return { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) };
}

export function toEpochDay(d: LocalDate): number {
  const { year, month, day } = parts(d);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function fromEpochDay(n: number): LocalDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10) as LocalDate;
}

export function addDays(d: LocalDate, n: number): LocalDate {
  return fromEpochDay(toEpochDay(d) + n);
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

/** 0 = domingo … 6 = sábado */
export function dayOfWeek(d: LocalDate): number {
  return new Date(toEpochDay(d) * DAY_MS).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Dia `day` do mês, limitado ao último dia (31 em fevereiro → 28/29). */
export function clampedDate(year: number, month: number, day: number): LocalDate {
  return ymd(year, month, Math.min(day, daysInMonth(year, month)));
}

export function addMonths(d: LocalDate, n: number): LocalDate {
  const { year, month, day } = parts(d);
  const total = year * 12 + (month - 1) + n;
  return clampedDate(Math.floor(total / 12), (total % 12) + 1, day);
}

export function startOfMonth(d: LocalDate): LocalDate {
  const { year, month } = parts(d);
  return ymd(year, month, 1);
}

export function endOfMonth(d: LocalDate): LocalDate {
  const { year, month } = parts(d);
  return ymd(year, month, daysInMonth(year, month));
}

export function compare(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

const SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Converte um instante para a data civil em São Paulo. */
export function toLocalDateSP(instant: Date | string): LocalDate {
  const dt = typeof instant === 'string' ? new Date(instant) : instant;
  return SAO_PAULO.format(dt) as LocalDate;
}

export function todaySP(now: Date = new Date()): LocalDate {
  return toLocalDateSP(now);
}

export function formatBR(d: LocalDate): string {
  const { year, month, day } = parts(d);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}
