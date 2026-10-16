const COMMON = [
  '123456',
  'password',
  'senha',
  'qwerty',
  'abc123',
  '111111',
  'iloveyou',
  'admin',
  'letmein',
];

/** Regra simples e previsível: ≥ 12 caracteres, 3 tipos de caractere (ou ≥ 16), sem sequências óbvias. */
export function checkPasswordStrength(pw: string): { ok: true } | { ok: false; reason: string } {
  if (pw.length < 12) return { ok: false, reason: 'Use pelo menos 12 caracteres.' };
  if (pw.length > 256) return { ok: false, reason: 'Senha longa demais.' };
  const lower = pw.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) return { ok: false, reason: 'Evite senhas comuns.' };
  if (/^(.)\1+$/.test(pw)) return { ok: false, reason: 'Evite repetir o mesmo caractere.' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3 && pw.length < 16) {
    return {
      ok: false,
      reason: 'Misture letras maiúsculas, minúsculas, números ou símbolos (ou use 16+ caracteres).',
    };
  }
  return { ok: true };
}
