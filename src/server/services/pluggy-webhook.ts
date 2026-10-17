import 'server-only';
import { env } from '@/lib/env';
import { getPluggy } from '@/server/adapters/pluggy/client';
import { WEBHOOK_SECRET_HEADER } from './webhook-auth';

const PATH = '/api/webhooks/pluggy';

export type WebhookStatus = {
  /** URL que este deploy espera receber da Pluggy. */
  expectedUrl: string;
  registered: boolean;
  /** Outras URLs deste app registradas na Pluggy (ex.: deploy antigo ou ngrok). */
  others: string[];
  secretSet: boolean;
};

export async function getWebhookStatus(): Promise<WebhookStatus> {
  const e = env();
  const expectedUrl = `${e.appUrl}${PATH}`;
  const ours = (await (await getPluggy()).listWebhooks()).filter((w) => w.url.includes(PATH));
  return {
    expectedUrl,
    registered: ours.some((w) => w.url === expectedUrl),
    others: ours.filter((w) => w.url !== expectedUrl).map((w) => w.url),
    secretSet: Boolean(e.PLUGGY_WEBHOOK_SECRET),
  };
}

/**
 * Registra (ou substitui) o webhook global na Pluggy apontando para este deploy, com o header
 * secreto que `/api/webhooks/pluggy` valida. Mesmo efeito do `pnpm pluggy:webhook`, sem precisar
 * rodar nada localmente.
 */
export async function registerWebhook(): Promise<WebhookStatus> {
  const e = env();
  if (!e.PLUGGY_WEBHOOK_SECRET) throw new Error('PLUGGY_WEBHOOK_SECRET não definida');
  const pluggy = await getPluggy();
  const url = `${e.appUrl}${PATH}`;
  for (const w of await pluggy.listWebhooks()) {
    if (w.url.includes(PATH)) await pluggy.deleteWebhook(w.id);
  }
  await pluggy.createWebhook(url, { [WEBHOOK_SECRET_HEADER]: e.PLUGGY_WEBHOOK_SECRET });
  return getWebhookStatus();
}
