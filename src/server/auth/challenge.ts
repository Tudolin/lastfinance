import 'server-only';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/server/db/client';

const { authChallenge } = schema;
type Purpose = (typeof schema.challengePurpose.enumValues)[number];

const TTL_MS = 5 * 60_000;

export async function createChallenge(purpose: Purpose, challenge: string, userId: string | null) {
  const [row] = await getDb()
    .insert(authChallenge)
    .values({ purpose, challenge, userId, expiresAt: new Date(Date.now() + TTL_MS) })
    .returning({ id: authChallenge.id });
  return row!.id;
}

/** Consome o desafio (uso único, não expirado, mesma finalidade). */
export async function consumeChallenge(id: string, purpose: Purpose) {
  const [row] = await getDb()
    .update(authChallenge)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authChallenge.id, id),
        eq(authChallenge.purpose, purpose),
        isNull(authChallenge.usedAt),
        gt(authChallenge.expiresAt, new Date()),
      ),
    )
    .returning();
  return row ?? null;
}
