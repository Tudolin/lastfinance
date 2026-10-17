import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { hourSP, isQuietHour } from '@/domain/alerts/quiet';
import { addDays, diffDays, formatBR, todaySP, type LocalDate } from '@/domain/dates/local-date';
import { formatBRL } from '@/domain/money';
import { getPushSender } from '@/server/adapters/push/sender';
import { runAsSystem } from '@/server/auth/system';
import { getDb, schema } from '@/server/db/client';
import { log } from '@/server/log';
import { getOpenBills } from '@/server/queries/accounts';
import { getForecastView } from '@/server/queries/forecast';
import { getBudgets } from '@/server/queries/planning';
import { getSubscriptionsView } from '@/server/queries/wealth';
import { getAppSettings } from './settings';

const {
  transaction: tx,
  account,
  alertEvent,
  pushSubscription,
  institutionConnection,
  forecastEntry,
} = schema;

/** Tipos de alerta (a pessoa pode desligar cada um nas preferências da tela de Alertas). */
export const ALERT_TYPES = {
  large_expense: 'Gasto grande',
  budget: 'Orçamento perto do limite ou estourado',
  negative_projection: 'Previsão de saldo negativo',
  bill_due: 'Fatura vencendo',
  income_late: 'Salário ou entrada atrasada',
  connection_error: 'Conexão com o banco precisa de atenção',
  subscription_change: 'Assinatura nova ou mais cara',
} as const;
export type AlertType = keyof typeof ALERT_TYPES;

export type AlertCandidate = {
  type: AlertType;
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
};

const brl = (c: number) => formatBRL(c);
const BAD_CONNECTION = ['LOGIN_ERROR', 'OUTDATED', 'WAITING_USER_INPUT'];

/** Procura situações que merecem aviso. Cada uma tem uma chave estável, então não se repete. */
export async function detectAlerts(today: LocalDate = todaySP()): Promise<AlertCandidate[]> {
  const settings = await getAppSettings();
  const off = new Set(settings.alertsOff);
  const out: AlertCandidate[] = [];
  const db = getDb();

  if (!off.has('large_expense') && settings.alertLargeExpenseCents > 0) {
    const since = new Date(Date.now() - 48 * 3600 * 1000);
    const rows = await db
      .select({
        id: tx.id,
        amountCents: tx.amountCents,
        description: sql<string>`coalesce(${tx.userDescription}, ${tx.srcDescription})`,
        date: tx.competenceDate,
        accountName: account.name,
      })
      .from(tx)
      .innerJoin(account, eq(tx.accountId, account.id))
      .where(
        and(
          isNull(tx.deletedAt),
          eq(tx.kind, 'expense'),
          gte(tx.createdAt, since),
          gte(tx.competenceDate, addDays(today, -7)),
          lte(tx.amountCents, -settings.alertLargeExpenseCents),
        ),
      );
    for (const r of rows)
      out.push({
        type: 'large_expense',
        dedupeKey: `large:${r.id}`,
        title: `Gasto de ${brl(-r.amountCents)}`,
        body: `${r.description} · ${r.accountName} · ${formatBR(r.date as LocalDate)}`,
        url: `/transacoes/${r.id}`,
      });
  }

  if (!off.has('budget')) {
    const month = today.slice(0, 7);
    for (const b of await getBudgets(today)) {
      const level = b.pace.usedRatio >= 1 ? 100 : b.pace.usedRatio >= 0.8 ? 80 : null;
      if (!level) continue;
      out.push({
        type: 'budget',
        dedupeKey: `budget:${month}:${b.categoryId}:${level}`,
        title: level === 100 ? `Orçamento de ${b.label} estourado` : `${b.label}: 80% do orçamento`,
        body: `Gasto ${brl(b.pace.spentCents)} de ${brl(b.pace.limitCents)} neste mês.`,
        url: '/orcamentos',
      });
    }
  }

  if (!off.has('negative_projection')) {
    const f = await getForecastView(30);
    if (f.base.firstNegative)
      out.push({
        type: 'negative_projection',
        dedupeKey: `negative:${f.base.firstNegative}`,
        title: 'Seu saldo deve ficar negativo',
        body: `A previsão mostra saldo negativo a partir de ${formatBR(f.base.firstNegative as LocalDate)}; o menor saldo é ${brl(f.base.min.balance)} em ${formatBR(f.base.min.date as LocalDate)}.`,
        url: '/previsao',
      });
  }

  if (!off.has('bill_due')) {
    for (const b of await getOpenBills(today)) {
      const days = diffDays(b.dueDate as LocalDate, today);
      if (days < 0 || days > 3 || b.totalCents <= 0) continue;
      out.push({
        type: 'bill_due',
        dedupeKey: `bill:${b.accountId}:${b.dueDate}`,
        title: `Fatura ${b.accountName} vence ${days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`}`,
        body: `${brl(b.totalCents)} em ${formatBR(b.dueDate as LocalDate)}.`,
        url: '/cartoes',
      });
    }
  }

  if (!off.has('income_late')) {
    const late = await db
      .select()
      .from(forecastEntry)
      .where(
        and(
          eq(forecastEntry.status, 'atrasado'),
          eq(forecastEntry.direction, 'in'),
          gte(forecastEntry.expectedDate, addDays(today, -15)),
        ),
      );
    for (const e of late)
      out.push({
        type: 'income_late',
        dedupeKey: `late:${e.id}`,
        title: `${e.label} ainda não caiu`,
        body: `Era esperado em ${formatBR(e.cashDate as LocalDate)} (${brl(e.userOverrideCents ?? e.expectedCents)}).`,
        url: '/previsao/conciliacao',
      });
  }

  if (!off.has('connection_error')) {
    const conns = await db
      .select()
      .from(institutionConnection)
      .where(
        and(
          isNull(institutionConnection.deletedAt),
          inArray(institutionConnection.status, BAD_CONNECTION),
        ),
      );
    for (const c of conns)
      out.push({
        type: 'connection_error',
        dedupeKey: `conn:${c.id}:${c.status}:${today}`,
        title: `${c.connectorName}: reconecte a conta`,
        body:
          c.status === 'OUTDATED'
            ? 'Os dados pararam de atualizar. Abra Contas conectadas e atualize.'
            : 'O banco pediu login ou confirmação. Abra Contas conectadas para reconectar.',
        url: '/contas',
      });
  }

  if (!off.has('subscription_change')) {
    const subs = await getSubscriptionsView();
    for (const s of subs.items) {
      if (s.stale) continue;
      if (s.priceChange && s.priceChange.toCents > s.priceChange.fromCents)
        out.push({
          type: 'subscription_change',
          dedupeKey: `sub:${s.id}:${s.priceChange.toCents}`,
          title: `${s.name} ficou mais cara`,
          body: `De ${brl(s.priceChange.fromCents)} para ${brl(s.priceChange.toCents)}.`,
          url: '/assinaturas',
        });
      else if (s.isNew)
        out.push({
          type: 'subscription_change',
          dedupeKey: `subnew:${s.id}`,
          title: `Nova assinatura: ${s.name}`,
          body: `${brl(s.amountCents)} por ${s.periodicity === 'yearly' ? 'ano' : s.periodicity === 'weekly' ? 'semana' : 'mês'}.`,
          url: '/assinaturas',
        });
    }
  }
  return out;
}

/** Grava os alertas novos (os repetidos são ignorados pela chave). Devolve só os novos. */
export async function recordAlerts(candidates: AlertCandidate[]) {
  if (!candidates.length) return [];
  return getDb()
    .insert(alertEvent)
    .values(candidates)
    .onConflictDoNothing({ target: alertEvent.dedupeKey })
    .returning();
}

/**
 * Envia por push os alertas ainda não enviados (fora do horário de silêncio). Alertas com mais de
 * 3 dias não são mais empurrados, só ficam na tela.
 */
export async function sendPendingAlerts(now: Date = new Date()) {
  const settings = await getAppSettings();
  if (isQuietHour(hourSP(now), settings.quietStartHour, settings.quietEndHour))
    return { sent: 0, quiet: true };
  const sender = getPushSender();
  const db = getDb();
  const pending = await db
    .select()
    .from(alertEvent)
    .where(
      and(
        isNull(alertEvent.sentAt),
        isNull(alertEvent.readAt),
        gte(alertEvent.createdAt, new Date(now.getTime() - 3 * 86400_000)),
      ),
    )
    .orderBy(asc(alertEvent.createdAt))
    .limit(20);
  if (!pending.length) return { sent: 0, quiet: false };
  const subs = sender.enabled ? await db.select().from(pushSubscription) : [];
  let sent = 0;
  for (const a of pending) {
    for (const s of subs) {
      const r = await sender.send(s, {
        title: a.title,
        body: a.body,
        url: a.url ?? '/alertas',
        tag: a.dedupeKey,
      });
      if (r.ok) {
        sent++;
        await db
          .update(pushSubscription)
          .set({ lastSuccessAt: now, failures: 0 })
          .where(eq(pushSubscription.id, s.id));
      } else if (r.gone) {
        await db.delete(pushSubscription).where(eq(pushSubscription.id, s.id));
      } else {
        log.warn('push falhou', { code: r.error });
        await db
          .update(pushSubscription)
          .set({ failures: sql`${pushSubscription.failures} + 1` })
          .where(eq(pushSubscription.id, s.id));
      }
    }
    // marca mesmo sem inscrição: o alerta fica na caixa de entrada e não é reenviado depois
    await db.update(alertEvent).set({ sentAt: now }).where(eq(alertEvent.id, a.id));
  }
  return { sent, quiet: false };
}

/** Job: detecta, grava e envia. Roda sem cookie (como sistema). */
export async function evaluateAlerts(now: Date = new Date()) {
  return runAsSystem(async () => {
    const today = todaySP(now);
    const created = await recordAlerts(await detectAlerts(today));
    const push = await sendPendingAlerts(now);
    return { created: created.length, ...push };
  });
}

export async function listAlerts(limit = 100) {
  return getDb().select().from(alertEvent).orderBy(desc(alertEvent.createdAt)).limit(limit);
}
