/**
 * Horário de silêncio em horas cheias de São Paulo. `start > end` atravessa a meia-noite
 * (22 → 7 = das 22h às 6h59). `start === end` desliga o silêncio.
 */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Hora atual em São Paulo (0–23). */
export function hourSP(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
  );
}
