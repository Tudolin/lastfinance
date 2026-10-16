import { formatBR, parts, type LocalDate } from '@/domain/dates/local-date';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function monthName(month: number) {
  return MONTHS[month - 1]!;
}

export function monthTitle(d: LocalDate) {
  const { year, month } = parts(d);
  const m = monthName(month);
  return `${m[0]!.toUpperCase()}${m.slice(1)} de ${year}`;
}

/** "Sexta, 16/10/2026" */
export function weekdayDate(d: LocalDate, withYear = true) {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  const br = formatBR(d);
  return `${WEEKDAYS[dow]}, ${withYear ? br : br.slice(0, 5)}`;
}

export function shortDate(d: string) {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** "há 12 min", "há 3 h", "em 16/10 às 08:30" */
export function relativeTime(at: Date, now = new Date()) {
  const diff = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (diff < 1) return 'agora';
  if (diff < 60) return `há ${diff} min`;
  if (diff < 24 * 60) return `há ${Math.round(diff / 60)} h`;
  return `em ${at.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`;
}

export function dateTimeBR(at: Date | null | undefined) {
  if (!at) return '—';
  return at.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}
