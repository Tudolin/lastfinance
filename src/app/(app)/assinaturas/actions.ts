'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';

/** Marca ou desmarca uma recorrência como assinatura (a detecção não sobrescreve depois). */
export async function setSubscriptionAction(id: string, isSubscription: boolean) {
  await requireUnlocked();
  await getDb()
    .update(schema.recurringItem)
    .set({ isSubscription: z.boolean().parse(isSubscription), updatedAt: new Date() })
    .where(eq(schema.recurringItem.id, z.string().uuid().parse(id)));
  for (const p of ['/assinaturas', '/recorrencias']) revalidatePath(p);
  return { ok: true as const };
}
