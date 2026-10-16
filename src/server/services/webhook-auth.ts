import 'server-only';
import { env } from '@/lib/env';
import { safeEqual } from '@/server/security/crypto';

export const WEBHOOK_SECRET_HEADER = 'x-lastfinance-webhook-secret';

/** Verifica o header secreto (configurado no POST /webhooks da Pluggy) e, opcionalmente, o IP de origem. */
export function verifyWebhookRequest(
  headers: Headers,
): { ok: true } | { ok: false; status: 401 | 403 | 503 } {
  const e = env();
  if (!e.PLUGGY_WEBHOOK_SECRET) return { ok: false, status: 503 };
  const given = headers.get(WEBHOOK_SECRET_HEADER) ?? '';
  if (!safeEqual(given, e.PLUGGY_WEBHOOK_SECRET)) return { ok: false, status: 401 };
  if (e.PLUGGY_WEBHOOK_IP_ALLOWLIST) {
    const allow = e.PLUGGY_WEBHOOK_IP_ALLOWLIST.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = (headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
    if (!allow.includes(ip)) return { ok: false, status: 403 };
  }
  return { ok: true };
}
