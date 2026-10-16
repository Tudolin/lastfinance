/**
 * Privacidade: antes de qualquer chamada à IA, remove o que pode identificar pessoas ou contas.
 * Mantém só o necessário para categorizar o estabelecimento.
 */
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[chave]'],
  [/(\+?55\s?)?\(\d{2}\)\s?9?\d{4}-?\d{4}\b/g, '[telefone]'],
  [/\b(?:AG|AGENCIA|AGÊNCIA|CONTA|CC|C\/C)\s*[:.]?\s*[\d-]{3,}/gi, '[conta]'],
  [/\d{5,}/g, '#'],
];

export function sanitizeForAi(text: string): string {
  let s = text;
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s.replace(/\s+/g, ' ').trim().slice(0, 120);
}
