import 'server-only';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb, schema } from '@/server/db/client';

const { authAttempt } = schema;

export const LOCKOUT = {
  threshold: 5,
  baseMinutes: 15,
  ipWindowMinutes: 15,
  ipMaxFailures: 30,
} as const;

/**
 * Bloqueio progressivo: a partir de 5 falhas seguidas, 15 min; a cada +5 falhas, dobra.
 * Retorna quando o próximo login será permitido (ou null se liberado).
 */
export function lockoutUntil(
  failuresSinceSuccess: number,
  lastFailureAt: Date | null,
): Date | null {
  if (failuresSinceSuccess < LOCKOUT.threshold || !lastFailureAt) return null;
  const level = Math.floor((failuresSinceSuccess - LOCKOUT.threshold) / LOCKOUT.threshold);
  const minutes = LOCKOUT.baseMinutes * 2 ** Math.min(level, 6);
  return new Date(lastFailureAt.getTime() + minutes * 60_000);
}

async function failuresSinceLastSuccess(identifier: string) {
  const db = getDb();
  const [lastOk] = await db
    .select({ at: authAttempt.at })
    .from(authAttempt)
    .where(and(eq(authAttempt.identifier, identifier), eq(authAttempt.success, true)))
    .orderBy(desc(authAttempt.at))
    .limit(1);
  const since = lastOk?.at ?? new Date(0);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${authAttempt.at})` })
    .from(authAttempt)
    .where(
      and(
        eq(authAttempt.identifier, identifier),
        eq(authAttempt.success, false),
        gte(authAttempt.at, since),
      ),
    );
  return { n: r?.n ?? 0, last: r?.last ? new Date(r.last) : null };
}

export async function checkAllowed(identifiers: {
  account: string;
  ip: string;
}): Promise<{ allowed: true } | { allowed: false; retryAt: Date }> {
  const acc = await failuresSinceLastSuccess(identifiers.account);
  const until = lockoutUntil(acc.n, acc.last);
  if (until && until > new Date()) return { allowed: false, retryAt: until };

  const since = new Date(Date.now() - LOCKOUT.ipWindowMinutes * 60_000);
  const [ip] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(authAttempt)
    .where(
      and(
        eq(authAttempt.identifier, identifiers.ip),
        eq(authAttempt.success, false),
        gte(authAttempt.at, since),
      ),
    );
  if ((ip?.n ?? 0) >= LOCKOUT.ipMaxFailures)
    return { allowed: false, retryAt: new Date(Date.now() + LOCKOUT.ipWindowMinutes * 60_000) };
  return { allowed: true };
}

export async function recordAttempt(
  identifiers: { account: string; ip: string },
  success: boolean,
) {
  await getDb()
    .insert(authAttempt)
    .values([
      { identifier: identifiers.account, success },
      { identifier: identifiers.ip, success },
    ]);
}
