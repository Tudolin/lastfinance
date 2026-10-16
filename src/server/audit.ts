import 'server-only';
import { getDb, schema } from '@/server/db/client';

/** Trilha de auditoria de ações de segurança (sem valores financeiros). */
export async function audit(
  userId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await getDb().insert(schema.auditLog).values({ userId, action, metadata });
}
