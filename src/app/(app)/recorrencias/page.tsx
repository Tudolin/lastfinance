import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Pill } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import { getCategories } from '@/server/queries/categories';
import { getRecurringView } from '@/server/queries/income';
import { RecurringForm, RecurringStatusButtons } from './recurring-client';

export const metadata = { title: 'Recorrências' };

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

type Item = Awaited<ReturnType<typeof getRecurringView>>['confirmed'][number];

function when(i: Item) {
  if (i.periodicity === 'weekly') return `toda ${WEEKDAYS[i.anchorDay]}`;
  if (i.periodicity === 'yearly')
    return `todo ano em ${String(i.anchorDay).padStart(2, '0')}/${String(i.anchorMonth ?? 1).padStart(2, '0')}`;
  return `todo dia ${i.anchorDay}`;
}

function Row({ i, children }: { i: Item; children: React.ReactNode }) {
  const stats = i.detectionStats as { occurrences?: number; confidence?: number } | null;
  return (
    <div
      className="flex flex-col gap-2 border-t border-surface-2 py-3 first:border-t-0 sm:flex-row sm:items-center"
      data-testid="recurring-row"
    >
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 font-bold">
          {i.name}
          {i.isSubscription ? <Pill className="bg-info-soft text-info-ink">assinatura</Pill> : null}
          <Pill className="bg-surface-2 text-ink-2">
            {i.nature === 'fixed' ? 'fixo' : 'variável'}
          </Pill>
        </span>
        {i.descriptionNorm && i.descriptionNorm !== i.name.toUpperCase() ? (
          <span className="text-xs font-semibold text-ink-2">{i.descriptionNorm}</span>
        ) : null}
        <span className="text-xs text-ink-2">
          {i.direction === 'out' ? 'Saída' : 'Entrada'} {when(i)}
          {i.accountName ? ` · ${i.accountName}` : ''}
          {i.categoryLabel ? ` · ${i.categoryLabel}` : ''}
          {stats?.occurrences ? ` · visto ${stats.occurrences}×` : ''}
          {i.lastSeenDate ? `, última em ${formatBR(i.lastSeenDate as LocalDate)}` : ''}
          {i.lastAmountCents != null && i.lastAmountCents !== i.amountCents ? (
            <>
              {' '}
              · último valor <Money cents={i.lastAmountCents} />
            </>
          ) : null}
        </span>
      </div>
      <Money
        cents={i.direction === 'out' ? -i.amountCents : i.amountCents}
        signed
        tone="auto"
        className="font-extrabold"
      />
      {children}
    </div>
  );
}

export default async function RecurringPage() {
  const [v, categories] = await Promise.all([getRecurringView(), getCategories()]);
  return (
    <>
      <PageHeader title="Recorrências" kicker={`Fixas confirmadas: ${v.confirmed.length}`} />
      <p className="-mt-2 text-sm text-ink-2">
        Detectadas no seu histórico (mesmo estabelecimento, intervalo regular). Só as confirmadas
        entram na previsão; ignoradas não voltam a ser sugeridas. Total mensal confirmado:{' '}
        <Money cents={v.monthlyOut} className="font-bold text-ink" />.
      </p>

      {v.suggested.length ? (
        <Card className="flex flex-col py-1">
          <CardTitle className="pt-3">Sugestões ({v.suggested.length})</CardTitle>
          {v.suggested.map((i) => (
            <Row key={i.id} i={i}>
              <RecurringStatusButtons id={i.id} status={i.status} name={i.name} />
            </Row>
          ))}
        </Card>
      ) : null}

      <Card className="flex flex-col py-1">
        <CardTitle className="pt-3">Confirmadas</CardTitle>
        {v.confirmed.length === 0 ? (
          <p className="py-3 text-sm text-ink-2">
            Nenhuma ainda. Confirme as sugestões acima ou crie uma.
          </p>
        ) : (
          v.confirmed.map((i) => (
            <div key={i.id}>
              <Row i={i}>
                <RecurringStatusButtons id={i.id} status={i.status} name={i.name} />
              </Row>
              <details className="mb-3 rounded-xl border border-border p-3">
                <summary className="cursor-pointer text-sm font-bold">Editar {i.name}</summary>
                <div className="mt-3">
                  <RecurringForm
                    defaults={{ ...i }}
                    accounts={v.accounts}
                    categories={categories}
                    submitLabel="Salvar"
                  />
                </div>
              </details>
            </div>
          ))
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Nova recorrência</CardTitle>
        <RecurringForm
          accounts={v.accounts}
          categories={categories}
          submitLabel="Adicionar recorrência"
        />
      </Card>

      {v.ignored.length ? (
        <details className="rounded-[18px] border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-bold">
            Ignoradas ({v.ignored.length})
          </summary>
          <div className="mt-2 flex flex-col">
            {v.ignored.map((i) => (
              <Row key={i.id} i={i}>
                <RecurringStatusButtons id={i.id} status={i.status} name={i.name} />
              </Row>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
