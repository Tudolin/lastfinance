import 'server-only';
import type { LocalDate } from '@/domain/dates/local-date';
import {
  DEFAULT_TAX_TABLES,
  resolveTaxTables,
  type TaxKind,
  type TaxTableRow,
  type TaxTables,
} from '@/domain/tax/tables';
import { getDb, schema } from '@/server/db/client';

/** Semeia as tabelas padrão (idempotente: não sobrescreve linhas já cadastradas). */
export async function ensureTaxTables() {
  await getDb()
    .insert(schema.taxTable)
    .values(
      DEFAULT_TAX_TABLES.map((t) => ({
        kind: t.kind,
        validFrom: t.validFrom,
        validTo: t.validTo,
        payload: t.payload,
        sourceUrl: t.sourceUrl,
        verifiedAt: t.verifiedAt,
      })),
    )
    .onConflictDoNothing();
}

export async function loadTaxRows(): Promise<TaxTableRow[]> {
  await ensureTaxTables();
  const rows = await getDb().select().from(schema.taxTable);
  return rows.map((r) => ({
    kind: r.kind as TaxKind,
    validFrom: r.validFrom as LocalDate,
    validTo: r.validTo as LocalDate | null,
    payload: r.payload,
    sourceUrl: r.sourceUrl,
    verifiedAt: r.verifiedAt as LocalDate,
  }));
}

/** Resolve as tabelas vigentes por data, com cache por mês (as vigências mudam no máximo mensalmente). */
export async function taxTablesResolver(): Promise<{
  tablesFor: (d: LocalDate) => TaxTables;
  fallbacksFor: (d: LocalDate) => TaxKind[];
  rows: TaxTableRow[];
}> {
  const rows = await loadTaxRows();
  const cache = new Map<string, ReturnType<typeof resolveTaxTables>>();
  const get = (d: LocalDate) => {
    const key = d.slice(0, 7);
    let r = cache.get(key);
    if (!r) {
      r = resolveTaxTables(rows, `${key}-01` as LocalDate);
      cache.set(key, r);
    }
    return r;
  };
  return { tablesFor: (d) => get(d).tables, fallbacksFor: (d) => get(d).fallbacks, rows };
}
