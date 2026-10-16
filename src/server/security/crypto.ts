import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

const KEY_VERSION = 'v1';

function dataKey(): Buffer {
  return Buffer.from(env().DATA_ENCRYPTION_KEY, 'base64');
}

/** AES-256-GCM. Formato: v1:<iv>:<tag>:<ciphertext> (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [KEY_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ct] = payload.split(':');
  if (version !== KEY_VERSION || !iv || !tag || !ct) throw new Error('Formato de dado cifrado inválido');
  const decipher = createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** HMAC com chave derivada por finalidade (separação de domínio). */
export function hmac(purpose: string, value: string): string {
  const key = createHmac('sha256', dataKey()).update(`lastfinance:${purpose}`).digest();
  return createHmac('sha256', key).update(value).digest('hex');
}

/** Hash de CPF/CNPJ (só dígitos). Nunca guardamos o documento em claro. */
export function hashDocument(doc: string | null | undefined): string | null {
  const digits = (doc ?? '').replace(/\D/g, '');
  if (digits.length !== 11 && digits.length !== 14) return null;
  return hmac('document', digits).slice(0, 40);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // tempo constante mesmo com tamanhos diferentes
    return false;
  }
  return timingSafeEqual(ab, bb);
}
