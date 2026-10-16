'use server';

import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { env } from '@/lib/env';
import { audit } from '@/server/audit';
import { consumeChallenge, createChallenge } from '@/server/auth/challenge';
import {
  burnPasswordTime,
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from '@/server/auth/password';
import { checkAllowed, recordAttempt } from '@/server/auth/rate-limit';
import {
  clearSessionCookie,
  clientInfo,
  clientIp,
  getCurrentSession,
  markAlive,
  requireSession,
  setSessionCookie,
} from '@/server/auth/request';
import { createSession, lockSession, revokeSession, unlockSession } from '@/server/auth/session';
import { consumeRecoveryCode, verifyTotpForUser } from '@/server/auth/totp';
import { authenticationOptions, verifyAuthentication } from '@/server/auth/webauthn';
import { getDb, schema } from '@/server/db/client';
import { randomToken, safeEqual } from '@/server/security/crypto';

export type FormState = { error?: string } | undefined;

const PENDING_LOGIN_COOKIE = 'lf_login';

/** Só aceita caminhos internos como destino depois do login (evita open redirect). */
function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function retryMessage(at: Date) {
  const t = at.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
  return `Muitas tentativas. Tente de novo às ${t}.`;
}

async function startSession(userId: string, next = '/') {
  const s = await createSession(userId, await clientInfo());
  await setSessionCookie(s.token, s.expiresAt);
  await markAlive();
  await audit(userId, 'login', { via: 'session' });
  redirect(safeNext(next));
}

// ───────────── Primeiro acesso ─────────────

const setupSchema = z
  .object({
    token: z.string().min(1, 'Informe o token de configuração.'),
    email: z.string().trim().toLowerCase().email('E-mail inválido.'),
    password: z.string(),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'As senhas não conferem.',
    path: ['confirm'],
  });

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = setupSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { token, email, password } = parsed.data;

  const expected = env().SETUP_TOKEN;
  if (!expected || !safeEqual(token, expected)) return { error: 'Token de configuração inválido.' };
  const strength = checkPasswordStrength(password);
  if (!strength.ok) return { error: strength.reason };

  const db = getDb();
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.appUser)) as [
    { n: number },
  ];
  if (n > 0) return { error: 'O app já foi configurado.' };

  const [user] = await db
    .insert(schema.appUser)
    .values({ email, passwordHash: await hashPassword(password) })
    .returning();
  await audit(user!.id, 'setup');
  const s = await createSession(user!.id, await clientInfo());
  await setSessionCookie(s.token, s.expiresAt);
  await markAlive();
  redirect('/configuracoes/seguranca?bemvindo=1');
}

// ───────────── Login com senha (+ TOTP opcional) ─────────────

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(fd.get('password') ?? '');
  const ids = { account: `login:${email}`, ip: `ip:${await clientIp()}` };

  const allowed = await checkAllowed(ids);
  if (!allowed.allowed) return { error: retryMessage(allowed.retryAt) };

  const [user] = await getDb().select().from(schema.appUser).where(eq(schema.appUser.email, email));
  const ok = user
    ? await verifyPassword(user.passwordHash, password)
    : (await burnPasswordTime(password), false);
  await recordAttempt(ids, ok);
  if (!ok || !user) return { error: 'E-mail ou senha incorretos.' };

  if (user.totpEnabled) {
    const challengeId = await createChallenge('totp_login', randomToken(16), user.id);
    (await cookies()).set(PENDING_LOGIN_COOKIE, challengeId, {
      httpOnly: true,
      secure: env().appUrl.startsWith('https://'),
      sameSite: 'strict',
      path: '/login',
      maxAge: 300,
    });
    redirect('/login/totp');
  }
  await startSession(user.id, String(fd.get('next') ?? '/'));
}

export async function totpLoginAction(_: FormState, fd: FormData): Promise<FormState> {
  const jar = await cookies();
  const challengeId = jar.get(PENDING_LOGIN_COOKIE)?.value;
  if (!challengeId) return { error: 'A etapa de login expirou. Entre com a senha de novo.' };
  const [ch] = await getDb()
    .select()
    .from(schema.authChallenge)
    .where(eq(schema.authChallenge.id, challengeId));
  if (!ch || ch.usedAt || ch.expiresAt < new Date() || !ch.userId)
    return { error: 'A etapa de login expirou. Entre com a senha de novo.' };

  const ids = { account: `totp:${ch.userId}`, ip: `ip:${await clientIp()}` };
  const allowed = await checkAllowed(ids);
  if (!allowed.allowed) return { error: retryMessage(allowed.retryAt) };

  const code = String(fd.get('code') ?? '').trim();
  const ok = /^\d{6}$/.test(code.replace(/\s/g, ''))
    ? await verifyTotpForUser(ch.userId, code)
    : await consumeRecoveryCode(ch.userId, code);
  await recordAttempt(ids, ok);
  if (!ok) return { error: 'Código inválido.' };

  await consumeChallenge(challengeId, 'totp_login');
  jar.delete({ name: PENDING_LOGIN_COOKIE, path: '/login' });
  await startSession(ch.userId);
}

// ───────────── Login com passkey (digital) ─────────────

export async function passkeyLoginOptionsAction() {
  return authenticationOptions('webauthn_login', null);
}

export async function passkeyLoginAction(
  challengeId: string,
  response: AuthenticationResponseJSON,
): Promise<FormState> {
  let userId: string;
  try {
    userId = await verifyAuthentication('webauthn_login', challengeId, response);
  } catch {
    return { error: 'Não foi possível entrar com a passkey.' };
  }
  await startSession(userId);
}

// ───────────── Bloqueio / desbloqueio / reautenticação ─────────────

export async function unlockOptionsAction() {
  const s = await requireSession();
  return authenticationOptions('webauthn_stepup', s.user.id);
}

export async function unlockPasskeyAction(
  challengeId: string,
  response: AuthenticationResponseJSON,
  next?: string,
): Promise<FormState> {
  const s = await requireSession();
  try {
    const userId = await verifyAuthentication('webauthn_stepup', challengeId, response);
    if (userId !== s.user.id) return { error: 'Passkey de outro usuário.' };
  } catch {
    return { error: 'Não foi possível confirmar com a digital.' };
  }
  await unlockSession(s.sessionId, s.settings.lockTimeoutMinutes);
  await markAlive();
  redirect(safeNext(next));
}

export async function unlockPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const s = await requireSession();
  const ids = { account: `login:${s.user.email}`, ip: `ip:${await clientIp()}` };
  const allowed = await checkAllowed(ids);
  if (!allowed.allowed) return { error: retryMessage(allowed.retryAt) };
  const [user] = await getDb()
    .select()
    .from(schema.appUser)
    .where(eq(schema.appUser.id, s.user.id));
  const ok = !!user && (await verifyPassword(user.passwordHash, String(fd.get('password') ?? '')));
  await recordAttempt(ids, ok);
  if (!ok) return { error: 'Senha incorreta.' };
  await unlockSession(s.sessionId, s.settings.lockTimeoutMinutes);
  await markAlive();
  redirect(safeNext(fd.get('next')));
}

export async function lockAction() {
  const s = await getCurrentSession();
  if (s) await lockSession(s.sessionId);
}

export async function logoutAction() {
  const s = await getCurrentSession();
  if (s) {
    await revokeSession(s.sessionId, s.user.id);
    await audit(s.user.id, 'logout');
  }
  await clearSessionCookie();
  redirect('/login');
}
