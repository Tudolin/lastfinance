import 'server-only';
import { desc, eq, sql } from 'drizzle-orm';
import { addDays, todaySP, type LocalDate } from '@/domain/dates/local-date';
import { annualFromDaily } from '@/domain/investments/yield';
import { getDb, schema } from '@/server/db/client';

const { rateHistory } = schema;

/** Séries do SGS do Banco Central. */
export const SERIES = { cdi: '12', selic: '11', selicTarget: '432' } as const;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const realFetcher: Fetcher = (url) =>
  fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
let fetcher = realFetcher;
export function setRatesFetcherForTests(f: Fetcher | undefined) {
  fetcher = f ?? realFetcher;
}

const br = (d: LocalDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const iso = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

/** Baixa a janela recente de cada série e grava (idempotente). Falha de uma série não derruba as outras. */
export async function refreshRates(today: LocalDate = todaySP(), days = 15) {
  const from = addDays(today, -days);
  const out: Record<string, number | string> = {};
  for (const [name, code] of Object.entries(SERIES)) {
    try {
      const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${br(from)}&dataFinal=${br(today)}`;
      const res = await fetcher(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as { data: string; valor: string }[];
      const values = rows
        .map((r) => ({ series: code, date: iso(r.data), rate: Number(r.valor) }))
        .filter((r) => Number.isFinite(r.rate) && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
      if (values.length)
        await getDb()
          .insert(rateHistory)
          .values(values)
          .onConflictDoUpdate({
            target: [rateHistory.series, rateHistory.date],
            set: { rate: sql`excluded.rate`, fetchedAt: new Date() },
          });
      out[name] = values.length;
    } catch (e) {
      out[name] = `erro: ${(e as Error).message}`;
    }
  }
  return out;
}

async function latest(series: string) {
  const [r] = await getDb()
    .select()
    .from(rateHistory)
    .where(eq(rateHistory.series, series))
    .orderBy(desc(rateHistory.date))
    .limit(1);
  return r ?? null;
}

/**
 * CDI e Selic anuais mais recentes (frações), do que já foi gravado pelo job diário. Sem dado,
 * devolve null e as telas usam uma taxa informada pela pessoa.
 */
export async function currentRates() {
  const [cdi, selicTarget] = await Promise.all([latest(SERIES.cdi), latest(SERIES.selicTarget)]);
  return {
    cdiAnnual: cdi ? annualFromDaily(cdi.rate) : null,
    cdiDate: (cdi?.date ?? null) as LocalDate | null,
    selicAnnual: selicTarget ? selicTarget.rate / 100 : null,
  };
}
