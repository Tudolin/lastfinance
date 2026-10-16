import 'server-only';
import { applyBatchJob } from '@/server/services/categorize';
import { runItemSync } from '@/server/services/item-sync';
import { processWebhookEvent } from '@/server/services/webhooks';
import type { JobEvent } from './events';
import { inlineStep, type JobStep } from './step';

let inlineRun = 0;

export async function handle(step: JobStep, event: JobEvent, runId: string) {
  switch (event.name) {
    case 'pluggy/webhook.received':
      return processWebhookEvent(step, event.data.webhookEventId);
    case 'pluggy/item.sync':
      return runItemSync(step, { ...event.data, runId });
    case 'ai/batch.submitted':
      // Inline (dev/testes): o lote falso termina na hora. No Inngest, a função dedicada espera com step.sleep.
      return step.run('apply-batch', () => applyBatchJob(event.data.jobId));
  }
}

export async function runInline(event: JobEvent) {
  inlineRun++;
  await handle(inlineStep, event, `inline:${Date.now()}:${inlineRun}`);
}
