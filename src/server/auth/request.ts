import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { env } from '@/lib/env';
import { ipPrefix, validateSessionToken, type ClientInfo, type SessionState } from './session';
import { systemSession } from './system';

export function sessionCookieName() {
  // __Host- exige HTTPS; em desenvolvimento (http://localhost) usamos o nome simples.
  return env().appUrl.startsWith('https://') ? '__Host-lf_session' : 'lf_session';
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: env().appUrl.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(sessionCookieName());
  jar.delete(ALIVE_COOKIE);
}

/**
 * Cookie de sessão do navegador (sem validade): some quando o app/navegador é fechado.
 * Sem ele, a sessão continua válida mas o app abre BLOQUEADO — "ao reabrir, pede a digital".
 */
export const ALIVE_COOKIE = 'lf_alive';

export async function markAlive() {
  (await cookies()).set(ALIVE_COOKIE, '1', {
    httpOnly: true,
    secure: env().appUrl.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
  });
}

export async function clientInfo(): Promise<ClientInfo> {
  const h = await headers();
  return {
    userAgent: h.get('user-agent'),
    ipPrefix: ipPrefix(h.get('x-forwarded-for') ?? h.get('x-real-ip')),
  };
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? 'local').split(',')[0]!.trim();
}

/** Sessão da requisição atual (memoizada por requisição). */
export const getCurrentSession = cache(async (): Promise<SessionState | null> => {
  const jar = await cookies();
  const s = await validateSessionToken(jar.get(sessionCookieName())?.value);
  if (s && !jar.has(ALIVE_COOKIE)) return { ...s, locked: true };
  return s;
});

export async function requireSession(): Promise<SessionState> {
  const sys = systemSession();
  if (sys) return sys;
  const s = await getCurrentSession();
  if (!s) redirect('/login');
  return s;
}

/**
 * Exigido por TODA leitura de dados financeiros (camada de acesso a dados).
 * Com o app bloqueado, nenhum valor é carregado: o usuário vai para a tela de desbloqueio.
 */
export async function requireUnlocked(): Promise<SessionState> {
  const s = await requireSession();
  if (s.locked) redirect('/unlock');
  return s;
}

/** Ações sensíveis exigem digital/senha nos últimos 5 minutos. */
export async function requireStepUp(next: string): Promise<SessionState> {
  const s = await requireUnlocked();
  if (!s.stepUpFresh) redirect(`/reauth?next=${encodeURIComponent(next)}`);
  return s;
}
