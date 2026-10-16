import { foldText } from '../text/normalize';

export type Installment = { number: number; total: number };

const MAX_INSTALLMENTS = 48;

function valid(n: number, total: number): Installment | null {
  if (!Number.isInteger(n) || !Number.isInteger(total)) return null;
  if (total < 2 || total > MAX_INSTALLMENTS || n < 1 || n > total) return null;
  return { number: n, total };
}

/**
 * Extrai "parcela atual / total" da descrição.
 * Reconhece "3/10", "03/10", "PARC 03/10", "PARCELA 3 DE 10", "3 DE 10".
 * Evita confundir datas ("12/03") exigindo contexto ou total ≤ 48 e parcela ≤ total.
 */
export function parseInstallmentFromDescription(description: string): Installment | null {
  const s = foldText(description);

  const explicit = /\bPARC(?:ELA)?\.?\s*(\d{1,2})\s*(?:DE|\/)\s*(\d{1,2})\b/.exec(s);
  if (explicit) return valid(Number(explicit[1]), Number(explicit[2]));

  const deForm = /\b(\d{1,2})\s+DE\s+(\d{1,2})\b/.exec(s);
  if (deForm) return valid(Number(deForm[1]), Number(deForm[2]));

  // "NETSHOES 03/10": barra no fim da descrição (ou seguida de texto sem outra barra de data).
  const matches = [...s.matchAll(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?!\/\d)(?=\s|$)/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    const r = valid(Number(m[1]), Number(m[2]));
    // "12/03" com 03 < 12 seria data (dia/mês) — já descartado por n > total.
    if (r) return r;
  }
  return null;
}

/** Prioriza o metadado estruturado da Pluggy; cai para o parse da descrição. */
export function resolveInstallment(
  meta: { installmentNumber?: number | null; totalInstallments?: number | null } | null | undefined,
  description: string,
): Installment | null {
  if (meta?.installmentNumber != null && meta.totalInstallments != null) {
    const r = valid(meta.installmentNumber, meta.totalInstallments);
    if (r) return r;
  }
  return parseInstallmentFromDescription(description);
}
