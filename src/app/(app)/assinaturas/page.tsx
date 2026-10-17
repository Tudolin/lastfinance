import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Pill } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import { cn } from '@/lib/cn';
import { getSubscriptionsView } from '@/server/queries/wealth';
import { SubscriptionToggle } from './subscription-client';

export const metadata = { title: 'Assinaturas' };

const PERIOD = { weekly: 'por semana', monthly: 'por mês', yearly: 'por ano' } as const;

export default async function SubscriptionsPage() {
  const v = await getSubscriptionsView();
  return (
    <>
      <PageHeader title="Assinaturas" kicker={`${v.items.length} no seu histórico`} />
      <Card
        className="flex flex-col gap-1 bg-primary text-primary-ink"
        aria-label="Total em assinaturas"
      >
        <span className="text-sm font-bold text-hero-sub">Você gasta com assinaturas</span>
        <span className="text-3xl font-extrabold" data-testid="subs-monthly">
          <Money cents={v.monthlyCents} /> <span className="text-base">por mês</span>
        </span>
        <span className="text-sm text-hero-sub">
          <Money cents={v.annualCents} /> por ano, sem contar as que pararam de cobrar.
        </span>
      </Card>

      <Card className="flex flex-col py-1">
        {v.items.length === 0 ? (
          <p className="py-4 text-sm text-ink-2">
            Nenhuma assinatura identificada ainda. Elas vêm das recorrências na categoria de
            assinaturas, ou das que você marcar abaixo.
          </p>
        ) : (
          v.items.map((i) => (
            <div
              key={i.id}
              className={cn(
                'flex flex-col gap-2 border-t border-surface-2 py-3 first:border-t-0 sm:flex-row sm:items-center',
                i.stale && 'opacity-70',
              )}
              data-testid="subscription-row"
            >
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-bold">
                  {i.name}
                  {i.isNew ? <Pill className="bg-info-soft text-info-ink">nova</Pill> : null}
                  {i.priceChange ? (
                    <Pill
                      className={
                        i.priceChange.toCents > i.priceChange.fromCents
                          ? 'bg-warn-soft text-warn-ink'
                          : 'bg-primary-soft text-primary-on-soft'
                      }
                    >
                      {i.priceChange.toCents > i.priceChange.fromCents ? 'aumentou' : 'baixou'}
                    </Pill>
                  ) : null}
                  {i.stale ? (
                    <Pill className="bg-surface-2 text-ink-2">parou de cobrar?</Pill>
                  ) : null}
                  {i.status === 'suggested' ? (
                    <Pill className="bg-surface-2 text-ink-2">a confirmar</Pill>
                  ) : null}
                </span>
                <span className="text-xs text-ink-2">
                  <Money cents={i.amountCents} /> {PERIOD[i.periodicity]}
                  {i.priceChange ? (
                    <>
                      {' '}
                      · última cobrança <Money cents={i.priceChange.toCents} />
                    </>
                  ) : null}
                  {i.category ? ` · ${i.category}` : ''}
                  {i.lastSeenDate ? ` · última em ${formatBR(i.lastSeenDate as LocalDate)}` : ''}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <Money cents={i.annualCents} className="font-extrabold" />
                <span className="text-xs text-ink-2">por ano</span>
              </div>
              <SubscriptionToggle id={i.id} name={i.name} on />
            </div>
          ))
        )}
      </Card>

      {v.others.length ? (
        <Card className="flex flex-col py-1">
          <CardTitle className="pt-3">Outras contas fixas</CardTitle>
          <p className="text-sm text-ink-2">
            Alguma destas é assinatura (streaming, app, academia)? Marque para somar aqui.
          </p>
          {v.others.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-2 border-t border-surface-2 py-2 first:border-t-0"
            >
              <span className="flex-1 text-sm font-bold">{o.name}</span>
              <Money cents={o.amountCents} className="text-sm" />
              <SubscriptionToggle id={o.id} name={o.name} on={false} />
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}
