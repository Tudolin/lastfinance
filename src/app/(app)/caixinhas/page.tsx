import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Pill } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import { cn } from '@/lib/cn';
import { getSavingsView } from '@/server/queries/wealth';
import { EmergencyMonths, GoalButtons, GoalForm, YieldSimulator } from './savings-client';

export const metadata = { title: 'Caixinhas e metas' };

const pct = (x: number) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

const STATUS = {
  done: { label: 'concluída', cls: 'bg-primary-soft text-primary-on-soft' },
  on_track: { label: 'no ritmo', cls: 'bg-primary-soft text-primary-on-soft' },
  behind: { label: 'atrasada', cls: 'bg-warn-soft text-warn-ink' },
  no_date: { label: 'sem data', cls: 'bg-surface-2 text-ink-2' },
} as const;

function Bar({ ratio, tone = 'primary' }: { ratio: number; tone?: 'primary' | 'warn' }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-track" aria-hidden="true">
      <div
        className={cn('h-full rounded-full', tone === 'warn' ? 'bg-warn' : 'bg-[#2e9a78]')}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` }}
      />
    </div>
  );
}

function rateLabel(i: {
  rate: number | null;
  rateType: string | null;
  fixedAnnualRate: number | null;
}) {
  if (i.rate != null && i.rateType) return `${i.rate.toLocaleString('pt-BR')}% do ${i.rateType}`;
  if (i.fixedAnnualRate != null) return `${i.fixedAnnualRate.toLocaleString('pt-BR')}% a.a.`;
  return null;
}

export default async function SavingsPage() {
  const v = await getSavingsView();
  const e = v.emergency;
  const goals = v.goals.filter((g) => g.status === 'active');
  const done = v.goals.filter((g) => g.status === 'done');
  return (
    <>
      <PageHeader title="Caixinhas e metas" kicker="Quanto você tem guardado" />
      <p className="-mt-2 text-sm text-ink-2">
        {v.rates.cdiAnnual != null ? (
          <>
            CDI {pct(v.rates.cdiAnnual)} ao ano
            {v.rates.selicAnnual != null ? ` · Selic ${pct(v.rates.selicAnnual)}` : ''} (Banco
            Central, {formatBR(v.rates.cdiDate as LocalDate)}).
          </>
        ) : (
          'As taxas do Banco Central chegam na próxima atualização diária.'
        )}
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="flex flex-col gap-3 lg:col-span-2" aria-label="Reserva de emergência">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>Reserva de emergência</CardTitle>
            <EmergencyMonths months={e.targetMonths} />
          </div>
          {e.monthlyEssentialCents > 0 ? (
            <>
              <p className="text-sm">
                Seu dinheiro disponível (contas + investimentos) cobre{' '}
                <strong data-testid="emergency-months">
                  {Number.isFinite(e.months)
                    ? `${e.months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`
                    : 'muitos meses'}
                </strong>{' '}
                dos seus gastos essenciais (<Money cents={e.monthlyEssentialCents} /> por mês, a
                média de fixos e variáveis recorrentes dos últimos 3 meses).
              </p>
              <Bar ratio={e.ratio} tone={e.ratio < 1 ? 'warn' : 'primary'} />
              <p className="text-sm text-ink-2">
                {e.missingCents > 0 ? (
                  <>
                    Faltam <Money cents={e.missingCents} className="font-bold text-ink" /> para{' '}
                    {e.targetMonths} meses (<Money cents={e.targetCents} />
                    ).
                  </>
                ) : (
                  <>
                    Meta de <Money cents={e.targetCents} /> atingida.
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-2">
              Ainda não há histórico de gastos suficiente para calcular a reserva.
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-1" aria-label="Investimentos">
          <CardTitle>Investimentos</CardTitle>
          <p className="text-2xl font-extrabold">
            <Money cents={v.investedCents} />
          </p>
          {v.investments.length === 0 ? (
            <p className="text-sm text-ink-2">
              Nenhum investimento nas contas conectadas. Caixinhas e CDBs aparecem aqui quando o
              banco os informa.
            </p>
          ) : (
            <ul className="flex flex-col">
              {v.investments.map((i) => (
                <li key={i.id} className="border-t border-surface-2 py-2 first:border-t-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold">{i.name}</span>
                    <Money cents={i.netCents} className="font-bold" />
                  </div>
                  <div className="text-xs text-ink-2">
                    {[
                      i.institution,
                      rateLabel(i),
                      i.dueDate ? `vence ${formatBR(i.dueDate as LocalDate)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    {i.profitCents ? (
                      <>
                        {' '}
                        · rendeu <Money cents={i.profitCents} />
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="flex flex-col py-1 lg:col-span-2" aria-label="Metas">
          <CardTitle className="pt-3">Metas</CardTitle>
          {goals.length === 0 ? (
            <p className="py-4 text-sm text-ink-2">Nenhuma meta ainda. Crie a primeira ao lado.</p>
          ) : (
            goals.map((g) => {
              const s = STATUS[g.progress.status];
              return (
                <div
                  key={g.id}
                  className="flex flex-col gap-2 border-t border-surface-2 py-3 first:border-t-0"
                  data-testid="goal-row"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 font-bold">{g.name}</span>
                    <Pill className={s.cls}>{s.label}</Pill>
                  </div>
                  <Bar
                    ratio={g.progress.ratio}
                    tone={g.progress.status === 'behind' ? 'warn' : 'primary'}
                  />
                  <div className="text-sm text-ink-2">
                    <Money cents={g.progress.savedCents} className="font-bold text-ink" /> de{' '}
                    <Money cents={g.targetCents} /> ({Math.round(g.progress.ratio * 100)}%)
                    {g.targetDate ? ` · até ${formatBR(g.targetDate as LocalDate)}` : ''}
                    {g.investmentName ? ` · em ${g.investmentName}` : ''}
                    {g.progress.monthlyNeededCents ? (
                      <>
                        {' '}
                        · guarde <Money cents={g.progress.monthlyNeededCents} /> por mês
                      </>
                    ) : null}
                  </div>
                  <GoalButtons
                    id={g.id}
                    name={g.name}
                    manual={!g.investmentId}
                    savedCents={g.progress.savedCents}
                    status={g.status}
                  />
                </div>
              );
            })
          )}
          {done.length ? (
            <details className="border-t border-surface-2 py-3">
              <summary className="cursor-pointer text-sm font-bold">
                Concluídas ({done.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {done.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">
                      {g.name} · <Money cents={g.targetCents} />
                    </span>
                    <GoalButtons
                      id={g.id}
                      name={g.name}
                      manual={!g.investmentId}
                      savedCents={g.progress.savedCents}
                      status={g.status}
                    />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-3 self-start">
          <CardTitle>Nova meta</CardTitle>
          <GoalForm investments={v.investments.map((i) => ({ id: i.id, name: i.name }))} />
        </Card>
      </div>

      <YieldSimulator
        cdiAnnual={v.rates.cdiAnnual}
        selicAnnual={v.rates.selicAnnual}
        cdiDate={v.rates.cdiDate ? formatBR(v.rates.cdiDate) : null}
      />
    </>
  );
}
