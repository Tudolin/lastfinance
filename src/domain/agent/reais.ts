/**
 * Converte o resultado de uma ferramenta para o formato que a IA lê: todo campo `xxxCents` (ou
 * `cents`) vira `xxx` em reais com duas casas, para o modelo nunca ter que dividir por 100.
 */
export function centsToReais(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(centsToReais);
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const isCents = k === 'cents' || k.endsWith('Cents');
    if (isCents && (typeof v === 'number' || v === null)) {
      const key = k === 'cents' ? 'reais' : k.slice(0, -'Cents'.length);
      out[key] = v === null ? null : Math.round(v) / 100;
    } else {
      out[k] = centsToReais(v);
    }
  }
  return out;
}
