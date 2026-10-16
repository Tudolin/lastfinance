import type { TxKind } from '../classification/types';
import { diffDays, type LocalDate } from '../dates/local-date';
import type { Cents } from '../money';
import { normalizeDescription } from '../text/normalize';
import type { Direction, ForecastSourceType, ForecastStatus } from './types';

export type MatchableEntry = {
  id: string;
  sourceType: ForecastSourceType;
  direction: Direction;
  accountId: string | null;
  expectedDate: LocalDate;
  windowStart: LocalDate;
  windowEnd: LocalDate;
  expectedCents: Cents;
  tolerancePct: number;
  matchPattern: string | null;
};

export type MatchableTx = {
  id: string;
  accountId: string;
  date: LocalDate;
  amountCents: Cents;
  description: string;
  kind: TxKind;
};

export type MatchCandidate = { entryId: string; txId: string; score: number; deltaCents: Cents };

export const MATCH_PARAMS = {
  minScore: 0.55,
  /** Com descrição muito parecida (empregador, estabelecimento), aceita diferença maior de valor. */
  strongSimilarity: 0.5,
  strongTolerance: 0.35,
};

const KINDS_FOR: Record<Direction, readonly TxKind[]> = {
  in: ['income'],
  out: ['expense'],
};

const tokens = (s: string) =>
  new Set(
    normalizeDescription(s)
      .split(' ')
      .filter((t) => t.length > 1),
  );

/**
 * Quanto do padrão aparece na descrição (0..1). Contenção, não Jaccard: "EMPRESA X" deve casar
 * com "TED EMPRESA X LTDA SALARIO" mesmo com as palavras a mais do banco.
 */
export function patternSimilarity(pattern: string, description: string): number {
  const p = tokens(pattern);
  if (p.size === 0) return 0;
  const d = tokens(description);
  let hit = 0;
  for (const t of p) if (d.has(t)) hit++;
  return hit / p.size;
}

/** Pontua um par previsto × transação; null quando não é candidato. */
export function scorePair(e: MatchableEntry, t: MatchableTx): MatchCandidate | null {
  if (e.sourceType === 'installment') return null;
  if (!KINDS_FOR[e.direction].includes(t.kind)) return null;
  if ((e.direction === 'in') !== t.amountCents > 0) return null;
  if (e.accountId && e.accountId !== t.accountId) return null;
  if (t.date < e.windowStart || t.date > e.windowEnd) return null;
  const actual = Math.abs(t.amountCents);
  const delta = actual - e.expectedCents;
  const rel = Math.abs(delta) / Math.max(1, e.expectedCents);
  const sim = e.matchPattern ? patternSimilarity(e.matchPattern, t.description) : 0.5;
  const tolerance = Math.max(e.tolerancePct, 0.005);
  const withinAmount =
    rel <= tolerance ||
    (!!e.matchPattern &&
      sim >= MATCH_PARAMS.strongSimilarity &&
      rel <= Math.max(tolerance, MATCH_PARAMS.strongTolerance));
  if (!withinAmount) return null;
  const halfWindow = Math.max(1, diffDays(e.windowEnd, e.windowStart) / 2);
  const dateScore = Math.max(0, 1 - Math.abs(diffDays(t.date, e.expectedDate)) / halfWindow);
  const amountScore = Math.max(0, 1 - rel / Math.max(tolerance, MATCH_PARAMS.strongTolerance));
  const score = Math.round((0.45 * amountScore + 0.25 * dateScore + 0.3 * sim) * 1000) / 1000;
  if (score < MATCH_PARAMS.minScore) return null;
  return { entryId: e.id, txId: t.id, score, deltaCents: delta };
}

/**
 * Conciliação automática: pareamento guloso 1:1 pela maior pontuação, determinístico.
 * Nunca usa uma transação ou um previsto que já tenham par, nem um par que o usuário desfez.
 */
export function reconcile(
  entries: readonly MatchableEntry[],
  txs: readonly MatchableTx[],
  opts: {
    matchedEntryIds?: ReadonlySet<string>;
    matchedTxIds?: ReadonlySet<string>;
    rejectedPairs?: ReadonlySet<string>;
  } = {},
): MatchCandidate[] {
  const usedE = new Set(opts.matchedEntryIds ?? []);
  const usedT = new Set(opts.matchedTxIds ?? []);
  const rejected = opts.rejectedPairs ?? new Set<string>();
  const candidates: MatchCandidate[] = [];
  for (const e of entries) {
    if (usedE.has(e.id)) continue;
    for (const t of txs) {
      if (usedT.has(t.id) || rejected.has(`${e.id}|${t.id}`)) continue;
      const c = scorePair(e, t);
      if (c) candidates.push(c);
    }
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Math.abs(a.deltaCents) - Math.abs(b.deltaCents) ||
      (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : a.txId < b.txId ? -1 : 1),
  );
  const out: MatchCandidate[] = [];
  for (const c of candidates) {
    if (usedE.has(c.entryId) || usedT.has(c.txId)) continue;
    usedE.add(c.entryId);
    usedT.add(c.txId);
    out.push(c);
  }
  return out;
}

/** Situação de um previsto: o usuário decide cancelado/ajustado; o resto vem da conciliação e da data. */
export function entryStatus(
  e: { windowEnd: LocalDate; status: ForecastStatus },
  matched: boolean,
  today: LocalDate,
): ForecastStatus {
  if (matched) return 'realizado';
  if (e.status === 'cancelado' || e.status === 'ajustado') return e.status;
  return today > e.windowEnd ? 'atrasado' : 'previsto';
}

/**
 * Fator de calibração de uma renda: mediana de real ÷ previsto nas últimas conciliações,
 * limitado a ±25% para um mês atípico não distorcer a previsão.
 */
export function calibrationFactor(
  pairs: readonly { expectedCents: Cents; actualCents: Cents }[],
): number {
  const ratios = pairs
    .filter((p) => p.expectedCents > 0)
    .slice(-3)
    .map((p) => p.actualCents / p.expectedCents)
    .sort((a, b) => a - b);
  if (ratios.length === 0) return 1;
  const m = Math.floor(ratios.length / 2);
  const med = ratios.length % 2 ? ratios[m]! : (ratios[m - 1]! + ratios[m]!) / 2;
  return Math.round(Math.min(1.25, Math.max(0.75, med)) * 10000) / 10000;
}
