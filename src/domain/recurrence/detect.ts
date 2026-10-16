import { diffDays, parts, type LocalDate } from '../dates/local-date';
import type { Cents } from '../money';

export type Periodicity = 'weekly' | 'monthly' | 'yearly';

export type RecurrenceTx = {
  id: string;
  accountId: string;
  date: LocalDate;
  amountCents: Cents;
  descriptionNorm: string;
  categoryId: string | null;
};

export type RecurrenceSuggestion = {
  /** Chave estável: descrição normalizada + sentido. */
  key: string;
  descriptionNorm: string;
  direction: 'in' | 'out';
  accountId: string;
  categoryId: string | null;
  periodicity: Periodicity;
  /** Dia do mês (mensal/anual), dia da semana 0–6 (semanal). */
  anchorDay: number;
  anchorMonth: number | null;
  amountCents: Cents;
  lastAmountCents: Cents;
  tolerancePct: number;
  nature: 'fixed' | 'variable';
  occurrences: number;
  lastDate: LocalDate;
  /** Coeficiente de variação do valor. */
  cv: number;
  confidence: number;
};

export const RECURRENCE_PARAMS = {
  minMonthly: 3,
  minWeekly: 4,
  minYearly: 2,
  /** Fração mínima dos intervalos dentro da faixa da periodicidade. */
  regularity: 0.7,
  /** Abaixo deste coeficiente de variação, o valor é considerado fixo. */
  fixedCv: 0.05,
};

const RANGES: Record<Periodicity, { median: [number, number]; each: [number, number] }> = {
  weekly: { median: [6, 8], each: [5, 10] },
  monthly: { median: [26, 35], each: [20, 40] },
  yearly: { median: [350, 380], each: [330, 400] },
};

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function stats(xs: readonly number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, sd, cv: mean ? sd / Math.abs(mean) : 0 };
}

/**
 * Detecta cobranças/receitas recorrentes: agrupa por descrição normalizada e sentido, olha os
 * intervalos entre ocorrências e a estabilidade do valor. Uma recorrência que parou (última
 * ocorrência há mais de 1,5 período) não é sugerida.
 */
export function detectRecurrences(
  txs: readonly RecurrenceTx[],
  today: LocalDate,
): RecurrenceSuggestion[] {
  const groups = new Map<string, RecurrenceTx[]>();
  for (const t of txs) {
    if (t.amountCents === 0 || !t.descriptionNorm) continue;
    const key = `${t.descriptionNorm}|${t.amountCents < 0 ? 'out' : 'in'}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: RecurrenceSuggestion[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // Mais de uma no mesmo dia (ex.: duas assinaturas iguais) → conta uma vez por data.
    const byDate = new Map<string, RecurrenceTx[]>();
    for (const t of sorted) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
    const dates = [...byDate.keys()] as LocalDate[];
    if (dates.length < RECURRENCE_PARAMS.minYearly) continue;
    const intervals = dates.slice(1).map((d, i) => diffDays(d, dates[i]!));
    const med = median(intervals);
    const periodicity = (Object.keys(RANGES) as Periodicity[]).find(
      (p) => med >= RANGES[p].median[0] && med <= RANGES[p].median[1],
    );
    if (!periodicity) continue;
    const min =
      periodicity === 'monthly'
        ? RECURRENCE_PARAMS.minMonthly
        : periodicity === 'weekly'
          ? RECURRENCE_PARAMS.minWeekly
          : RECURRENCE_PARAMS.minYearly;
    if (dates.length < min) continue;
    const [lo, hi] = RANGES[periodicity].each;
    const regular = intervals.filter((i) => i >= lo && i <= hi).length / intervals.length;
    if (regular < RECURRENCE_PARAMS.regularity) continue;
    const last = dates[dates.length - 1]!;
    if (diffDays(today, last) > med * 1.5 + 5) continue;

    const amounts = dates.map((d) =>
      byDate.get(d)!.reduce((s, t) => s + Math.abs(t.amountCents), 0),
    );
    const recent = amounts.slice(-6);
    const { cv } = stats(recent);
    const amount = Math.round(median(recent));
    const lastTx = byDate.get(last)![0]!;
    const anchorDay =
      periodicity === 'weekly'
        ? new Date(`${last}T12:00:00Z`).getUTCDay()
        : Math.round(median(dates.slice(-6).map((d) => parts(d).day)));
    const categoryCounts = new Map<string, number>();
    for (const t of sorted)
      if (t.categoryId)
        categoryCounts.set(t.categoryId, (categoryCounts.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const confidence = Math.min(
      1,
      Math.round(
        (0.4 * regular + 0.3 * Math.min(1, dates.length / 6) + 0.3 * Math.max(0, 1 - cv * 3)) * 100,
      ) / 100,
    );
    out.push({
      key,
      descriptionNorm: lastTx.descriptionNorm,
      direction: lastTx.amountCents < 0 ? 'out' : 'in',
      accountId: lastTx.accountId,
      categoryId,
      periodicity,
      anchorDay,
      anchorMonth: periodicity === 'yearly' ? parts(last).month : null,
      amountCents: amount,
      lastAmountCents: amounts[amounts.length - 1]!,
      tolerancePct: Math.min(0.3, Math.max(0.05, Math.round(cv * 2 * 100) / 100)),
      nature: cv < RECURRENCE_PARAMS.fixedCv ? 'fixed' : 'variable',
      occurrences: dates.length,
      lastDate: last,
      cv: Math.round(cv * 1000) / 1000,
      confidence,
    });
  }
  return out.sort((a, b) => b.amountCents - a.amountCents);
}
