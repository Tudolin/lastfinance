import 'server-only';
import { Inngest, eventType } from 'inngest';
import { requeueStuckWebhooks } from '@/server/services/webhooks';
import { getDb, schema } from '@/server/db/client';
import { isNull } from 'drizzle-orm';
import { aiBatchData, itemSyncData, webhookReceivedData } from './events';
import { applyBatchJob } from '@/server/services/categorize';
import { handle } from './handlers';
import type { JobStep } from './step';

/** Nossos passos só retornam dados já serializáveis em JSON, então o tipo "Jsonify" do Inngest é o próprio T. */
function asJobStep(step: {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
}): JobStep {
  return { run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T> };
}

export const inngest = new Inngest({ id: 'lastfinance' });

const webhookReceived = eventType('pluggy/webhook.received', { schema: webhookReceivedData });
const itemSync = eventType('pluggy/item.sync', { schema: itemSyncData });
const aiBatch = eventType('ai/batch.submitted', { schema: aiBatchData });

export const processWebhookFn = inngest.createFunction(
  {
    id: 'process-pluggy-webhook',
    triggers: [webhookReceived],
    retries: 5,
    idempotency: 'event.data.webhookEventId',
  },
  async ({ event, step }) =>
    handle(
      asJobStep(step),
      { name: 'pluggy/webhook.received', data: event.data },
      event.id ?? 'no-id',
    ),
);

export const itemSyncFn = inngest.createFunction(
  {
    id: 'sync-pluggy-item',
    triggers: [itemSync],
    retries: 4,
    // Nunca dois syncs do mesmo item ao mesmo tempo; rajadas de webhooks viram um sync só.
    concurrency: { key: 'event.data.pluggyItemId', limit: 1 },
    debounce: { key: 'event.data.pluggyItemId', period: '45s' },
  },
  async ({ event, step, runId }) =>
    handle(asJobStep(step), { name: 'pluggy/item.sync', data: event.data }, runId),
);

/**
 * Rede de segurança: a cada 6 h relê a janela incremental de todos os itens (cobre webhooks perdidos
 * — a Pluggy tenta no máximo 3 vezes) e reenfileira eventos presos. Não chama "atualizar item" na Pluggy,
 * para não gastar cota do Open Finance.
 */
export const fallbackSyncFn = inngest.createFunction(
  {
    id: 'fallback-sync',
    triggers: [{ cron: 'TZ=America/Sao_Paulo 15 */6 * * *' }, { event: 'app/fallback.requested' }],
  },
  async ({ step }) => {
    const items = await step.run('list-items', async () =>
      (
        await getDb()
          .select({ pluggyItemId: schema.institutionConnection.pluggyItemId })
          .from(schema.institutionConnection)
          .where(isNull(schema.institutionConnection.deletedAt))
      ).map((r) => r.pluggyItemId),
    );
    await step.run('requeue-webhooks', () => requeueStuckWebhooks());
    if (items.length) {
      await step.sendEvent(
        'fan-out',
        items.map((pluggyItemId) =>
          itemSync.create({ pluggyItemId, mode: 'incremental', trigger: 'cron' }),
        ),
      );
    }
    return { items: items.length };
  },
);

/**
 * Carga histórica de categorização via Message Batches (50% mais barato): espera o lote terminar
 * (normalmente < 1 h, no máximo 24 h) com sleeps duráveis e aplica os resultados.
 */
export const applyAiBatchFn = inngest.createFunction(
  { id: 'apply-ai-batch', triggers: [aiBatch], retries: 3, concurrency: { limit: 1 } },
  async ({ event, step }) => {
    for (let i = 0; i < 300; i++) {
      const r = await step.run(`check-${i}`, () => applyBatchJob(event.data.jobId));
      if (r.ended) return r;
      await step.sleep(`wait-${i}`, '5m');
    }
    return { ended: false };
  },
);

export const functions = [processWebhookFn, itemSyncFn, fallbackSyncFn, applyAiBatchFn];
