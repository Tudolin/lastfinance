import 'server-only';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { getPluggy } from '@/server/adapters/pluggy/client';
import { getDb, schema } from '@/server/db/client';
import { dispatch } from '@/server/jobs/dispatch';
import type { JobStep } from '@/server/jobs/step';
import { log } from '@/server/log';
import { mapTransaction } from './pluggy-mapping';
import { categorizePending } from './categorize';
import { postprocess } from './postprocess';
import {
  markConnectionDeleted,
  refreshConnection,
  softDeleteByPluggyIds,
  upsertTransactions,
  type SyncedAccount,
} from './sync';

const { webhookEvent, account, institutionConnection } = schema;

/** Formato mínimo comum a todos os eventos; o resto é validado por tipo no processamento. */
export const webhookPayloadSchema = z
  .object({
    event: z.string().min(1),
    eventId: z.string().min(1),
    itemId: z.string().optional(),
  })
  .passthrough();

export type IngestResult = { status: 'accepted' | 'duplicate'; id: string };

/**
 * Chamado pelo route handler. Precisa ser rápido (a Pluggy exige 2xx em até 10 s):
 * grava o evento (idempotente por `eventId`) e enfileira. Nada de chamadas à Pluggy aqui.
 */
export async function ingestWebhook(raw: unknown): Promise<IngestResult> {
  const payload = webhookPayloadSchema.parse(raw);
  const db = getDb();
  const [inserted] = await db
    .insert(webhookEvent)
    .values({
      eventId: payload.eventId,
      event: payload.event,
      itemId: payload.itemId ?? null,
      payload: payload as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: webhookEvent.eventId })
    .returning({ id: webhookEvent.id });

  if (inserted) {
    await enqueue(inserted.id);
    return { status: 'accepted', id: inserted.id };
  }
  // Duplicado: se a tentativa anterior gravou mas não conseguiu enfileirar, enfileira agora.
  const [existing] = await db
    .select()
    .from(webhookEvent)
    .where(eq(webhookEvent.eventId, payload.eventId));
  if (existing && existing.status === 'received') await enqueue(existing.id);
  return { status: 'duplicate', id: existing!.id };
}

async function enqueue(id: string) {
  await dispatch({ name: 'pluggy/webhook.received', data: { webhookEventId: id } });
  await getDb()
    .update(webhookEvent)
    .set({ status: 'enqueued', enqueuedAt: new Date() })
    .where(and(eq(webhookEvent.id, id), eq(webhookEvent.status, 'received')));
}

/** Reenfileira eventos que ficaram presos (ex.: falha ao enviar para a fila). Usado pelo job de fallback. */
export async function requeueStuckWebhooks(olderThanMinutes = 10) {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const stuck = await db
    .select({ id: webhookEvent.id })
    .from(webhookEvent)
    .where(
      and(
        or(eq(webhookEvent.status, 'received'), eq(webhookEvent.status, 'enqueued')),
        lt(webhookEvent.receivedAt, cutoff),
      ),
    )
    .limit(100);
  for (const s of stuck)
    await dispatch({ name: 'pluggy/webhook.received', data: { webhookEventId: s.id } });
  return stuck.length;
}

const txCreated = z.object({
  itemId: z.string(),
  accountId: z.string(),
  transactionsCreatedAtFrom: z.string(),
});
const txChanged = z.object({
  itemId: z.string(),
  accountId: z.string(),
  transactionIds: z.array(z.string()),
});

async function localAccount(pluggyAccountId: string): Promise<SyncedAccount | null> {
  const [a] = await getDb()
    .select({ id: account.id, pluggyAccountId: account.pluggyAccountId, kind: account.kind })
    .from(account)
    .where(eq(account.pluggyAccountId, pluggyAccountId));
  return a ?? null;
}

async function connectionExists(pluggyItemId: string) {
  const [c] = await getDb()
    .select({ id: institutionConnection.id })
    .from(institutionConnection)
    .where(eq(institutionConnection.pluggyItemId, pluggyItemId));
  return !!c;
}

/** Processa um evento já gravado. Idempotente: pode rodar mais de uma vez sem efeito colateral. */
export async function processWebhookEvent(step: JobStep, webhookEventId: string) {
  const db = getDb();
  const [ev] = await db.select().from(webhookEvent).where(eq(webhookEvent.id, webhookEventId));
  if (!ev || ev.status === 'processed' || ev.status === 'ignored') return { skipped: true };
  const p = ev.payload;
  const runId = `wh:${ev.eventId}`;

  try {
    let outcome: 'processed' | 'ignored' = 'processed';
    switch (ev.event) {
      case 'item/created':
      case 'item/updated':
      case 'item/login_succeeded': {
        await step.run('dispatch-sync', () =>
          dispatch({
            name: 'pluggy/item.sync',
            data: { pluggyItemId: String(p.itemId), mode: 'incremental', trigger: 'webhook' },
          }),
        );
        break;
      }
      case 'item/error':
      case 'item/waiting_user_input':
      case 'item/waiting_user_action': {
        // Só atualiza o status (a tela de contas mostra "precisa reconectar"); alertas chegam na Fase 5.
        await step.run('refresh-item', async () => {
          await refreshConnection(String(p.itemId));
        });
        break;
      }
      case 'item/deleted': {
        await step.run('mark-deleted', () => markConnectionDeleted(String(p.itemId)));
        break;
      }
      case 'transactions/created': {
        const d = txCreated.parse(p);
        if (!(await connectionExists(d.itemId))) {
          // Item ainda desconhecido: um sync completo cobre estas transações.
          await step.run('dispatch-sync', () =>
            dispatch({
              name: 'pluggy/item.sync',
              data: { pluggyItemId: d.itemId, mode: 'backfill', trigger: 'webhook' },
            }),
          );
          break;
        }
        const acc = await localAccount(d.accountId);
        if (!acc) {
          await step.run('dispatch-sync', () =>
            dispatch({
              name: 'pluggy/item.sync',
              data: { pluggyItemId: d.itemId, mode: 'incremental', trigger: 'webhook' },
            }),
          );
          break;
        }
        let after: string | null = null;
        let page = 0;
        do {
          const r: { next: string | null } = await step.run(`fetch-created:${page}`, async () => {
            const res = await (
              await getPluggy()
            ).fetchTransactionsPage(acc.pluggyAccountId, {
              createdAtFrom: d.transactionsCreatedAtFrom,
              after,
            });
            await upsertTransactions(
              acc,
              res.results.map((t) => mapTransaction(t, acc)),
              runId,
            );
            return { next: res.next };
          });
          after = r.next;
          page++;
        } while (after && page < 50);
        await step.run('postprocess', () => postprocess());
        await step.run('categorize', () =>
          categorizePending({ mode: 'sync', maxAiMerchants: 100 }),
        );
        break;
      }
      case 'transactions/updated': {
        const d = txChanged.parse(p);
        const acc = await localAccount(d.accountId);
        if (!acc) break;
        for (let i = 0; i < d.transactionIds.length; i += 500) {
          const ids = d.transactionIds.slice(i, i + 500);
          await step.run(`fetch-updated:${i}`, async () => {
            const res = await (
              await getPluggy()
            ).fetchTransactionsPage(acc.pluggyAccountId, { ids });
            await upsertTransactions(
              acc,
              res.results.map((t) => mapTransaction(t, acc)),
              runId,
            );
          });
        }
        await step.run('postprocess', () => postprocess());
        await step.run('categorize', () =>
          categorizePending({ mode: 'sync', maxAiMerchants: 100 }),
        );
        break;
      }
      case 'transactions/deleted': {
        const d = txChanged.parse(p);
        await step.run('soft-delete', () => softDeleteByPluggyIds(d.transactionIds));
        await step.run('postprocess', () => postprocess());
        await step.run('categorize', () =>
          categorizePending({ mode: 'sync', maxAiMerchants: 100 }),
        );
        break;
      }
      default:
        // connector/status_updated, eventos de pagamento etc. — o app é somente leitura.
        outcome = 'ignored';
    }
    await db
      .update(webhookEvent)
      .set({ status: outcome, processedAt: new Date(), attempts: ev.attempts + 1, error: null })
      .where(eq(webhookEvent.id, ev.id));
    return { outcome };
  } catch (err) {
    await db
      .update(webhookEvent)
      .set({
        status: 'failed',
        attempts: ev.attempts + 1,
        error: (err as Error).message?.slice(0, 300) ?? 'erro',
      })
      .where(eq(webhookEvent.id, ev.id));
    log.error('webhook falhou', err, { eventId: ev.eventId, event: ev.event });
    throw err;
  }
}

/** Lista eventos para a tela de status. */
export async function recentWebhookEvents(limit = 30) {
  return getDb()
    .select({
      id: webhookEvent.id,
      event: webhookEvent.event,
      status: webhookEvent.status,
      receivedAt: webhookEvent.receivedAt,
      processedAt: webhookEvent.processedAt,
      error: webhookEvent.error,
    })
    .from(webhookEvent)
    .orderBy(desc(webhookEvent.receivedAt))
    .limit(limit);
}
