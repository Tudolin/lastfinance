import 'server-only';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { getDb, schema } from '@/server/db/client';
import { randomToken, sha256 } from '@/server/security/crypto';
import { parseSettings } from './settings';

const { session, appUser } = schema;

/** Só atualiza `last_seen_at`/desbloqueio deslizante no banco a cada 60 s, para poupar escritas. */
const TOUCH_INTERVAL_MS = 60_000;
export const STEP_UP_MAX_AGE_MS = 5 * 60_000;

export type ClientInfo = { userAgent: string | null; ipPrefix: string | null };

export async function createSession(userId: string, client: ClientInfo) {
  const db = getDb();
  const [user] = await db.select().from(appUser).where(eq(appUser.id, userId));
  const settings = parseSettings(user?.settings);
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + settings.sessionDays * 86_400_000);
  const [row] = await db
    .insert(session)
    .values({
      userId,
      tokenHash: sha256(token),
      userAgent: client.userAgent?.slice(0, 300) ?? null,
      ipPrefix: client.ipPrefix,
      unlockedUntil: new Date(now + settings.lockTimeoutMinutes * 60_000),
      stepUpAt: new Date(now),
      expiresAt,
    })
    .returning({ id: session.id });
  return { token, expiresAt, sessionId: row!.id };
}

export type SessionState = {
  sessionId: string;
  user: { id: string; email: string; totpEnabled: boolean };
  locked: boolean;
  stepUpFresh: boolean;
  settings: ReturnType<typeof parseSettings>;
};

/**
 * Valida o token do cookie. Sessão expirada ou revogada → null.
 * Se desbloqueada, estende o desbloqueio (inatividade é medida a partir do último uso).
 */
export async function validateSessionToken(
  token: string | undefined | null,
  now = new Date(),
): Promise<SessionState | null> {
  if (!token) return null;
  const db = getDb();
  const [row] = await db
    .select({ s: session, u: appUser })
    .from(session)
    .innerJoin(appUser, eq(session.userId, appUser.id))
    .where(
      and(
        eq(session.tokenHash, sha256(token)),
        isNull(session.revokedAt),
        gt(session.expiresAt, now),
      ),
    );
  if (!row) return null;
  const settings = parseSettings(row.u.settings);
  const locked = row.s.unlockedUntil <= now;
  if (!locked && now.getTime() - row.s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(session)
      .set({
        lastSeenAt: now,
        unlockedUntil: new Date(now.getTime() + settings.lockTimeoutMinutes * 60_000),
      })
      .where(eq(session.id, row.s.id));
  }
  return {
    sessionId: row.s.id,
    user: { id: row.u.id, email: row.u.email, totpEnabled: row.u.totpEnabled },
    locked,
    stepUpFresh: !!row.s.stepUpAt && now.getTime() - row.s.stepUpAt.getTime() < STEP_UP_MAX_AGE_MS,
    settings,
  };
}

export async function lockSession(sessionId: string) {
  await getDb().update(session).set({ unlockedUntil: new Date() }).where(eq(session.id, sessionId));
}

/** Desbloqueio após digital/senha: também conta como reautenticação recente (step-up). */
export async function unlockSession(sessionId: string, lockTimeoutMinutes: number) {
  const now = Date.now();
  await getDb()
    .update(session)
    .set({
      unlockedUntil: new Date(now + lockTimeoutMinutes * 60_000),
      stepUpAt: new Date(now),
      lastSeenAt: new Date(now),
    })
    .where(eq(session.id, sessionId));
}

export async function revokeSession(sessionId: string, userId: string) {
  await getDb()
    .update(session)
    .set({ revokedAt: new Date() })
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)));
}

export async function revokeOtherSessions(currentSessionId: string, userId: string) {
  await getDb()
    .update(session)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(session.userId, userId), ne(session.id, currentSessionId), isNull(session.revokedAt)),
    );
}

export async function listActiveSessions(userId: string) {
  return getDb()
    .select({
      id: session.id,
      userAgent: session.userAgent,
      ipPrefix: session.ipPrefix,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    })
    .from(session)
    .where(
      and(eq(session.userId, userId), isNull(session.revokedAt), gt(session.expiresAt, new Date())),
    )
    .orderBy(desc(session.lastSeenAt));
}

/** Reduz o IP a um prefixo (/24 no IPv4, /48 no IPv6) — suficiente para reconhecer o dispositivo. */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.split(',')[0]!.trim();
  if (v.includes('.')) return v.split('.').slice(0, 3).join('.') + '.0/24';
  if (v.includes(':')) return v.split(':').slice(0, 3).join(':') + '::/48';
  return null;
}
