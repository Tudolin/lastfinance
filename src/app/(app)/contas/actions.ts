'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { env } from '@/lib/env';
import { audit } from '@/server/audit';
import { getPluggy } from '@/server/adapters/pluggy/client';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { DISPATCH_HELP, DispatchError, dispatch } from '@/server/jobs/dispatch';
import { refreshConnection } from '@/server/services/sync';

type Result = { ok: true; token?: string } | { ok: false; error: string; needStepUp?: boolean };

const itemIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/, 'ID inválido');

/** Token do widget Pluggy Connect. Reconectar uma instituição é ação sensível (pede digital/senha). */
export async function createConnectTokenAction(itemId?: string): Promise<Result> {
  const s = await requireUnlocked();
  if (itemId) {
    if (!s.stepUpFresh)
      return { ok: false, error: 'Confirme que é você para reconectar.', needStepUp: true };
    itemIdSchema.parse(itemId);
  }
  try {
    // Sem webhookUrl aqui: o webhook global (com header secreto) é registrado via `pnpm pluggy:webhook`.
    const token = await (await getPluggy()).createConnectToken({ itemId });
    return { ok: true, token };
  } catch {
    return { ok: false, error: 'Não foi possível falar com a Pluggy agora.' };
  }
}

/** Chamado quando o widget conclui (ou ao importar um item existente pelo ID). */
export async function registerItemAction(rawItemId: string): Promise<Result> {
  const s = await requireUnlocked();
  const parsed = itemIdSchema.safeParse(rawItemId);
  if (!parsed.success) return { ok: false, error: 'ID de item inválido.' };
  try {
    await refreshConnection(parsed.data);
  } catch {
    return { ok: false, error: 'Item não encontrado na sua aplicação Pluggy.' };
  }
  await audit(s.user.id, 'connection.registered', { itemId: parsed.data });
  revalidatePath('/contas');
  revalidatePath('/');
  try {
    await dispatch({
      name: 'pluggy/item.sync',
      data: { pluggyItemId: parsed.data, mode: 'backfill', trigger: 'connect' },
    });
  } catch (err) {
    if (err instanceof DispatchError)
      return { ok: false, error: `A instituição foi salva. ${DISPATCH_HELP}` };
    throw err;
  }
  return { ok: true };
}

export async function importItemAction(_: Result | undefined, fd: FormData): Promise<Result> {
  return registerItemAction(String(fd.get('itemId') ?? ''));
}

/** Relê o que a Pluggy já coletou (não gasta cota do Open Finance). */
export async function syncNowAction(pluggyItemId: string): Promise<Result> {
  await requireUnlocked();
  itemIdSchema.parse(pluggyItemId);
  try {
    await dispatch({
      name: 'pluggy/item.sync',
      data: { pluggyItemId, mode: 'incremental', trigger: 'manual' },
    });
  } catch (err) {
    if (err instanceof DispatchError) return { ok: false, error: DISPATCH_HELP };
    throw err;
  }
  revalidatePath('/contas');
  return { ok: true };
}

const MIN_MANUAL_UPDATE_MINUTES = 60;

/**
 * Pede à Pluggy uma coleta nova no banco. Gasta cota mensal do Open Finance, então limitamos a uma
 * por hora por instituição; o resultado chega pelo webhook item/updated.
 */
export async function requestUpdateAction(pluggyItemId: string): Promise<Result> {
  const s = await requireUnlocked();
  itemIdSchema.parse(pluggyItemId);
  const [conn] = await getDb()
    .select()
    .from(schema.institutionConnection)
    .where(eq(schema.institutionConnection.pluggyItemId, pluggyItemId));
  if (!conn) return { ok: false, error: 'Conexão não encontrada.' };
  const last = conn.pluggyLastUpdatedAt?.getTime() ?? 0;
  if (Date.now() - last < MIN_MANUAL_UPDATE_MINUTES * 60_000) {
    return {
      ok: false,
      error: `A última atualização foi há menos de ${MIN_MANUAL_UPDATE_MINUTES} minutos. Aguarde para não gastar a cota do Open Finance.`,
    };
  }
  await (await getPluggy()).requestItemUpdate(pluggyItemId);
  await audit(s.user.id, 'connection.update_requested', { itemId: pluggyItemId });
  return { ok: true };
}

/** Só no modo PLUGGY_FAKE: cria uma instituição sintética e sincroniza. */
export async function fakeConnectAction(kind: 'nubank' | 'itau'): Promise<Result> {
  await requireUnlocked();
  if (!env().PLUGGY_FAKE) return { ok: false, error: 'Disponível só no modo de demonstração.' };
  const { getFakePluggy } = await import('@/server/adapters/pluggy/fake');
  const itemId = getFakePluggy().seedInstitution(kind);
  return registerItemAction(itemId);
}
