import 'server-only';
import { hash, verify } from '@node-rs/argon2';

// Parâmetros recomendados pela OWASP para Argon2id (m=19 MiB, t=2, p=1).
const OPTS = {
  algorithm: 2 /* Argon2id */,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** Hash fixo para gastar o mesmo tempo quando o usuário não existe (evita enumeração por tempo). */
let dummy: Promise<string> | undefined;
export async function burnPasswordTime(password: string) {
  dummy ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummy, password);
}

export { checkPasswordStrength } from './password-strength';
