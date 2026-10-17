import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { dispatch } from '@/server/jobs/dispatch';
import { safeEqual } from '@/server/security/crypto';
import { getDb, schema } from '@/server/db/client';
import { isNull } from 'drizzle-orm';
import { evaluateAlerts } from '@/server/services/alerts';
import { refreshRates } from '@/server/services/rates';
import { takeNetWorthSnapshot } from '@/server/services/wealth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Despertador redundante do Vercel Cron (plano Hobby: 1×/dia). O agendamento principal é o do Inngest
 * (a cada 6 h); este garante pelo menos um sync diário mesmo se o Inngest falhar.
 */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!secret || !safeEqual(given, secret))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const items = await getDb()
    .select({ pluggyItemId: schema.institutionConnection.pluggyItemId })
    .from(schema.institutionConnection)
    .where(isNull(schema.institutionConnection.deletedAt));
  for (const i of items) {
    await dispatch({
      name: 'pluggy/item.sync',
      data: { pluggyItemId: i.pluggyItemId, mode: 'incremental', trigger: 'cron' },
    });
  }
  // redundância do job diário do Inngest: taxas do BCB e retrato do patrimônio
  const rates = await refreshRates().catch((e: Error) => e.message);
  await takeNetWorthSnapshot().catch(() => null);
  const alerts = await evaluateAlerts().catch((e: Error) => e.name);
  return NextResponse.json({ ok: true, items: items.length, rates, alerts });
}
