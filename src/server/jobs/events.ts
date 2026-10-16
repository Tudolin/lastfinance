import { z } from 'zod';

export const webhookReceivedData = z.object({ webhookEventId: z.string().uuid() });
export const itemSyncData = z.object({
  pluggyItemId: z.string(),
  mode: z.enum(['backfill', 'incremental']),
  trigger: z.enum(['webhook', 'cron', 'manual', 'backfill', 'connect']),
});

export type JobEvent =
  | { name: 'pluggy/webhook.received'; data: z.infer<typeof webhookReceivedData> }
  | { name: 'pluggy/item.sync'; data: z.infer<typeof itemSyncData> };
