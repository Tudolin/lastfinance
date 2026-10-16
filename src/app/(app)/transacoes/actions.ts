'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TX_KINDS } from '@/domain/classification/types';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { postprocess } from '@/server/services/postprocess';

const editSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().max(200),
  notes: z.string().trim().max(2000),
  tags: z.string().trim().max(300),
  kind: z.union([z.literal('auto'), z.enum(TX_KINDS)]),
});

export type EditState = { error?: string; ok?: boolean } | undefined;

/**
 * Edição manual. Grava só colunas `user_*`/notas/tags (o sync nunca as sobrescreve) e reprocessa
 * a classificação — uma transferência marcada à mão, por exemplo, ganha o par automaticamente.
 */
export async function updateTransactionAction(_: EditState, fd: FormData): Promise<EditState> {
  await requireUnlocked();
  const parsed = editSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: 'Dados inválidos.' };
  const { id, description, notes, tags, kind } = parsed.data;
  const db = getDb();
  const [row] = await db
    .select({ src: schema.transaction.srcDescription })
    .from(schema.transaction)
    .where(eq(schema.transaction.id, id));
  if (!row) return { error: 'Transação não encontrada.' };
  await db
    .update(schema.transaction)
    .set({
      userDescription: description && description !== row.src ? description : null,
      notes: notes || null,
      tags: tags
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#/, '').toLowerCase())
        .filter(Boolean)
        .slice(0, 20),
      userKind: kind === 'auto' ? null : kind,
    })
    .where(eq(schema.transaction.id, id));
  await postprocess();
  revalidatePath('/transacoes');
  revalidatePath(`/transacoes/${id}`);
  revalidatePath('/');
  return { ok: true };
}
