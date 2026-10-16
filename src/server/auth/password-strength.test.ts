import { describe, expect, it } from 'vitest';
import { checkPasswordStrength } from './password-strength';

describe('força da senha', () => {
  it.each(['curta1!A', 'senha123456789', 'aaaaaaaaaaaaaaaa', 'abcdefghijkl'])(
    'rejeita %s',
    (pw) => {
      expect(checkPasswordStrength(pw).ok).toBe(false);
    },
  );
  it.each(['Correta-Cavalo-9', 'frase longa sem simbolos mas comprida'])('aceita %s', (pw) => {
    expect(checkPasswordStrength(pw).ok).toBe(true);
  });
});
