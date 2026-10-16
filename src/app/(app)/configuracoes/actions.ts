'use server';

import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import { z } from 'zod';
import { audit } from '@/server/audit';
import { checkPasswordStrength, hashPassword, verifyPassword } from '@/server/auth/password';
import { requireUnlocked } from '@/server/auth/request';
import { revokeOtherSessions, revokeSession } from '@/server/auth/session';
import { parseSettings } from '@/server/auth/settings';
import {
  disableTotp,
  enableTotp,
  newTotpSecret,
  regenerateRecoveryCodes,
  verifyTotpForUser,
} from '@/server/auth/totp';
import { deletePasskey, registrationOptions, verifyRegistration } from '@/server/auth/webauthn';
import { getDb, schema } from '@/server/db/client';

export type ActionResult<T = unknown> =
  { ok: true; data?: T } | { ok: false; error: string; needStepUp?: boolean };

const STEP_UP = { ok: false as const, error: 'Confirme que é você.', needStepUp: true };

/** Ações sensíveis: exigem digital/senha nos últimos 5 minutos. */
async function requireFreshAuth() {
  const s = await requireUnlocked();
  return s.stepUpFresh ? s : null;
}

const SECURITY = '/configuracoes/seguranca';

// ───── Passkeys ─────

export async function passkeyRegisterOptionsAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof registrationOptions>>>
> {
  const s = await requireFreshAuth();
  if (!s) return STEP_UP;
  return { ok: true, data: await registrationOptions(s.user.id) };
}

export async function passkeyRegisterVerifyAction(
  challengeId: string,
  response: RegistrationResponseJSON,
  deviceName: string,
): Promise<ActionResult> {
  const s = await requireFreshAuth();
  if (!s) return STEP_UP;
  try {
    await verifyRegistration(
      s.user.id,
      challengeId,
      response,
      z.string().trim().max(60).parse(deviceName),
    );
  } catch {
    return { ok: false, error: 'Não foi possível cadastrar a passkey.' };
  }
  await audit(s.user.id, 'passkey.added');
  revalidatePath(SECURITY);
  return { ok: true };
}

export async function deletePasskeyAction(id: string): Promise<ActionResult> {
  const s = await requireFreshAuth();
  if (!s) return STEP_UP;
  await deletePasskey(s.user.id, z.string().uuid().parse(id));
  await audit(s.user.id, 'passkey.removed');
  revalidatePath(SECURITY);
  return { ok: true };
}

// ───── TOTP ─────

export async function totpStartAction(): Promise<ActionResult<{ secret: string; qr: string }>> {
  const s = await requireFreshAuth();
  if (!s) return STEP_UP;
  const { secret, uri } = newTotpSecret(s.user.email);
  return { ok: true, data: { secret, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) } };
}

export async function totpConfirmAction(
  secret: string,
  code: string,
): Promise<ActionResult<{ codes: string[] }>> {
  const s = await requireFreshAuth();
  if (!s) return STEP_UP;
  if (!/^[A-Z2-7]{16,64}$/.test(secret)) return { ok: false, error: 'Segredo inválido.' };
  if (!(await verifyTotpForUser(s.user.id, code, secret)))
    return { ok: false, error: 'Código incorreto. Confira o horário do celular.' };
  await enableTotp(s.user.id, secret);
  const codes = await regenerateRecoveryCodes(s.user.id);
  await audit(s.user.id, 'totp.enabled');
  revalidatePath(SECURITY);
  return { ok: true, data: { codes } };
}

export async function totpDisableAction(): Promise<ActionResult> {
  const s = await requireFreshAuth();
  if (!s) return STEP_UP;
  await disableTotp(s.user.id);
  await audit(s.user.id, 'totp.disabled');
  revalidatePath(SECURITY);
  return { ok: true };
}

export async function recoveryCodesAction(): Promise<ActionResult<{ codes: string[] }>> {
  const s = await requireFreshAuth();
  if (!s) return STEP_UP;
  const codes = await regenerateRecoveryCodes(s.user.id);
  await audit(s.user.id, 'recovery.regenerated');
  return { ok: true, data: { codes } };
}

// ───── Senha ─────

export async function changePasswordAction(
  _: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  const s = await requireFreshAuth();
  if (!s) return STEP_UP;
  const current = String(fd.get('current') ?? '');
  const next = String(fd.get('next') ?? '');
  if (next !== String(fd.get('confirm') ?? ''))
    return { ok: false, error: 'As senhas não conferem.' };
  const strength = checkPasswordStrength(next);
  if (!strength.ok) return { ok: false, error: strength.reason };
  const db = getDb();
  const [user] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, s.user.id));
  if (!user || !(await verifyPassword(user.passwordHash, current)))
    return { ok: false, error: 'Senha atual incorreta.' };
  await db
    .update(schema.appUser)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(schema.appUser.id, s.user.id));
  await revokeOtherSessions(s.sessionId, s.user.id);
  await audit(s.user.id, 'password.changed');
  return { ok: true };
}

// ───── Bloqueio ─────

const lockSchema = z.object({
  lockTimeoutMinutes: z.coerce.number().int().min(1).max(240),
  relockAfterBackgroundSeconds: z.coerce.number().int().min(0).max(3600),
});

export async function updateLockSettingsAction(
  _: ActionResult | undefined,
  fd: FormData,
): Promise<ActionResult> {
  const s = await requireUnlocked();
  const parsed = lockSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, error: 'Valores inválidos.' };
  const db = getDb();
  const [user] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, s.user.id));
  const settings = { ...parseSettings(user?.settings), ...parsed.data };
  await db.update(schema.appUser).set({ settings }).where(eq(schema.appUser.id, s.user.id));
  revalidatePath(SECURITY);
  return { ok: true };
}

// ───── Sessões ─────

export async function revokeSessionAction(id: string): Promise<ActionResult> {
  const s = await requireUnlocked();
  await revokeSession(z.string().uuid().parse(id), s.user.id);
  await audit(s.user.id, 'session.revoked');
  revalidatePath('/configuracoes/sessoes');
  return { ok: true };
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  const s = await requireUnlocked();
  await revokeOtherSessions(s.sessionId, s.user.id);
  await audit(s.user.id, 'session.revoked_others');
  revalidatePath('/configuracoes/sessoes');
  return { ok: true };
}
