/** Remove acentos, padroniza caixa e espaços. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Prefixos de adquirentes/subadquirentes que não identificam o estabelecimento.
const ACQUIRER_PREFIX =
  /^(?:PG ?\*|PAG\*|MP ?\*|MERCADOPAGO ?\*|EC ?\*|IFD ?\*|PAYPAL ?\*|SUMUP ?\*|STONE ?\*|PICPAY ?\*|EBANX ?\*|DL ?\*|EBN ?\*|HTM ?\*|APM ?\*|GOOGLE ?\*|ZP ?\*|PAGSEGURO ?\*)\s*/;

/**
 * Descrição normalizada para agrupar o mesmo estabelecimento:
 * sem acentos, sem marcador de parcela, sem datas/horas e números longos, sem prefixo de adquirente.
 * Ex.: "UBER *TRIP 12/03 SAO PAULO" → "UBER TRIP SAO PAULO"
 */
export function normalizeDescription(raw: string): string {
  let s = foldText(raw);
  s = s.replace(/\bPARC(?:ELA)?\.?\s*\d{1,2}\s*(?:DE|\/)\s*\d{1,2}\b/g, ' ');
  s = s.replace(/\b\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?\b/g, ' '); // 3/10, 12/03/2026
  s = s.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' '); // horários
  s = s.replace(/\b\d{5,}\b/g, ' '); // ids, autenticações, cartões
  s = s.replace(ACQUIRER_PREFIX, '');
  s = s.replace(/[^\p{L}\p{N} ]+/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Similaridade de Jaccard sobre tokens (0..1). */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(
    normalizeDescription(a)
      .split(' ')
      .filter((t) => t.length > 1),
  );
  const tb = new Set(
    normalizeDescription(b)
      .split(' ')
      .filter((t) => t.length > 1),
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
