import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/server/db/client';

export async function countPasskeys(userId: string) {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.webauthnCredential)
    .where(eq(schema.webauthnCredential.userId, userId));
  return r?.n ?? 0;
}
