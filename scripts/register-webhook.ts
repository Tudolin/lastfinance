/**
 * Registra (ou substitui) o webhook global na Pluggy com o header secreto.
 * Uso: PLUGGY_CLIENT_ID=… PLUGGY_CLIENT_SECRET=… PLUGGY_WEBHOOK_SECRET=… pnpm pluggy:webhook https://seu-app.vercel.app
 * Em desenvolvimento, passe a URL do ngrok (a Pluggy não aceita localhost).
 */
import { PluggyClient } from 'pluggy-sdk';

const base = process.argv[2]?.replace(/\/$/, '');
const {
  PLUGGY_CLIENT_ID: id,
  PLUGGY_CLIENT_SECRET: secret,
  PLUGGY_WEBHOOK_SECRET: hook,
} = process.env;
if (!id || !secret || !hook || !base?.startsWith('https://')) {
  console.error(
    'Uso: PLUGGY_CLIENT_ID=… PLUGGY_CLIENT_SECRET=… PLUGGY_WEBHOOK_SECRET=… pnpm pluggy:webhook https://<seu-domínio>',
  );
  process.exit(1);
}
const url = `${base}/api/webhooks/pluggy`;
const sdk = new PluggyClient({ clientId: id, clientSecret: secret });
const existing = (await sdk.fetchWebhooks()).results;
for (const w of existing.filter((w) => w.url.includes('/api/webhooks/pluggy'))) {
  await sdk.deleteWebhook(w.id);
  console.log('removido webhook antigo:', w.url);
}
const created = await sdk.createWebhook('all', url, { 'x-lastfinance-webhook-secret': hook });
console.log('webhook registrado:', created.id, created.url, '(evento: all)');
