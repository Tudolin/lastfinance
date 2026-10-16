import 'server-only';
import { eq, and, isNull } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import { getDb, schema } from '@/server/db/client';
import { decrypt, encrypt, hmac, randomToken } from '@/server/security/crypto';
import { parseSettings } from './settings';

const { appUser, recoveryCode } = schema;

function totpFor(secretBase32: string, label: string) {
  return new TOTP({
    issuer: 'lastfinance',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** Gera um segredo novo (ainda não ativado) e a URI para o QR code. */
export function newTotpSecret(email: string) {
  const secret = new Secret({ size: 20 }).base32;
  return { secret, uri: totpFor(secret, email).toString() };
}

/** Valida o código (janela de ±1 período) e impede reuso do mesmo código. */
export async function verifyTotpForUser(
  userId: string,
  code: string,
  pendingSecret?: string,
): Promise<boolean> {
  const db = getDb();
  const [user] = await db.select().from(appUser).where(eq(appUser.id, userId));
  if (!user) return false;
  const secret = pendingSecret ?? (user.totpSecretEnc ? decrypt(user.totpSecretEnc) : null);
  if (!secret) return false;
  const totp = totpFor(secret, user.email);
  const delta = totp.validate({ token: code.replace(/\s/g, ''), window: 1 });
  if (delta === null) return false;
  const counter = Math.floor(Date.now() / 1000 / 30) + delta;
  const settings = parseSettings(user.settings);
  if (settings.totpLastCounter !== undefined && counter <= settings.totpLastCounter) return false;
  await db
    .update(appUser)
    .set({ settings: { ...settings, totpLastCounter: counter } })
    .where(eq(appUser.id, userId));
  return true;
}

export async function enableTotp(userId: string, secret: string) {
  await getDb()
    .update(appUser)
    .set({ totpSecretEnc: encrypt(secret), totpEnabled: true })
    .where(eq(appUser.id, userId));
}

export async function disableTotp(userId: string) {
  await getDb()
    .update(appUser)
    .set({ totpSecretEnc: null, totpEnabled: false })
    .where(eq(appUser.id, userId));
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function formatCode(raw: string) {
  const chars = [...Buffer.from(raw, 'base64url')]
    .slice(0, 10)
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');
  return `${chars.slice(0, 5)}-${chars.slice(5, 10)}`;
}

/** Gera 10 códigos de recuperação de uso único (mostrados uma única vez). */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, () => formatCode(randomToken(16)));
  const db = getDb();
  await db.delete(recoveryCode).where(eq(recoveryCode.userId, userId));
  await db
    .insert(recoveryCode)
    .values(codes.map((c) => ({ userId, codeHash: hmac('recovery', c) })));
  return codes;
}

export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const normalized = code.trim().toUpperCase();
  const [row] = await getDb()
    .update(recoveryCode)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(recoveryCode.userId, userId),
        eq(recoveryCode.codeHash, hmac('recovery', normalized)),
        isNull(recoveryCode.usedAt),
      ),
    )
    .returning();
  return !!row;
}
