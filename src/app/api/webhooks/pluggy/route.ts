import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { log } from '@/server/log';
import { verifyWebhookRequest } from '@/server/services/webhook-auth';
import { ingestWebhook } from '@/server/services/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const MAX_BODY = 256 * 1024;

/**
 * Webhook da Pluggy. Responde rápido: valida, grava (idempotente por eventId) e enfileira.
 * Códigos: 401/403/400 não são reenviados pela Pluggy (correto para requisições inválidas);
 * 5xx são reenviados (falha nossa, transitória).
 */
export async function POST(req: Request) {
  const auth = verifyWebhookRequest(req.headers);
  if (!auth.ok) return NextResponse.json({ error: 'unauthorized' }, { status: auth.status });

  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'payload too large' }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    const r = await ingestWebhook(body);
    return NextResponse.json({ ok: true, status: r.status }, { status: 200 });
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
    log.error('falha ao gravar webhook', err);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
