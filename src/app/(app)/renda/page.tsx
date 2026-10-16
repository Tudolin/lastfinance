import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Pill } from '@/components/ui/badge';
import { Card, CardTitle, Notice } from '@/components/ui/card';
import { formatBR, parts, type LocalDate } from '@/domain/dates/local-date';
import { INCOME_EVENT_LABEL } from '@/domain/income/generate';
import type { PaymentRule } from '@/domain/income/payment-rule';
import type { CltDeductions } from '@/domain/tax/clt';
import { getIncomeView } from '@/server/queries/income';
import {
  DeleteButton,
  EventForm,
  IncomeForm,
  SalaryChangeForm,
  SalarySimulator,
  type IncomeDefaults,
} from './income-client';

export const metadata = { title: 'Renda' };

const TYPE_LABEL = { clt: 'CLT', pj: 'PJ', other: 'Outra' } as const;

function defaultsFor(
  s: Awaited<ReturnType<typeof getIncomeView>>['sources'][number],
): IncomeDefaults {
  const d = s.def;
  const rule = d.paymentRule as PaymentRule;
  const main = rule.parts[rule.parts.length - 1]!;
  const adv = rule.parts.length > 1 ? rule.parts[0]! : null;
  const ded = d.deductions as CltDeductions;
  const other = (label: string) => ded.others?.find((o) => o.label === label)?.cents ?? null;
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    employerName: d.matchPattern,
    accountId: d.accountId,
    startDate: d.startDate,
    endDate: d.endDate,
    gross: s.history[0]?.grossCents ?? s.gross,
    ruleType: main.rule.type,
    ruleN:
      main.rule.type === 'nth_business_day'
        ? main.rule.n
        : main.rule.type === 'fixed_day'
          ? main.rule.day
          : 5,
    monthOffset: main.monthOffset,
    saturday: rule.saturdayIsBusinessDay,
    advancePct: adv?.pct ?? null,
    advanceDay: adv && adv.rule.type === 'fixed_day' ? adv.rule.day : null,
    dependents: ded.dependents ?? d.pjConfig?.dependents ?? 0,
    alimony: ded.alimony ?? null,
    privatePension: ded.privatePension ?? null,
    transportVoucher: ded.transportVoucher ?? null,
    health: other('Plano de saúde'),
    meal: other('Vale-refeição/alimentação'),
    otherDeduction: other('Outros descontos'),
    regime: d.pjConfig?.regime,
    simplesAnnex: d.pjConfig?.simplesAnnex,
    rbt12: d.pjConfig?.rbt12 ?? null,
    issRate: d.pjConfig?.issRate != null ? d.pjConfig.issRate * 100 : null,
    manualRate: d.pjConfig?.manualRate != null ? d.pjConfig.manualRate * 100 : null,
    proLabore: d.pjConfig?.proLabore ?? null,
    monthlyCosts: d.pjConfig?.monthlyCosts ?? null,
    forecastMode: d.forecastMode,
    prorate: d.prorateFirstMonth,
  };
}

export default async function IncomePage() {
  const v = await getIncomeView();
  const year = parts(v.today).year;
  return (
    <>
      <PageHeader title="Renda" kicker="Fontes, salário líquido e calendário de pagamentos" />
      <Notice tone={v.fallbacks.length ? 'warn' : 'info'}>
        Tabelas fiscais de {year} (INSS, IRRF com a redução da Lei 15.270, Simples, MEI) conferidas
        em {v.verifiedAt ? formatBR(v.verifiedAt) : '—'}. São dados versionados no banco: quando
        sair uma tabela nova, basta cadastrar a nova vigência.{' '}
        {v.fallbacks.length
          ? `Sem tabela vigente para: ${v.fallbacks.join(', ')} (usando a mais recente).`
          : ''}
      </Notice>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Resumo da renda">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[13px] font-semibold text-ink-2">Líquido mensal previsto</span>
          <Money cents={v.totalNet} className="text-2xl font-extrabold" />
          <span className="text-xs text-ink-2">
            {v.sources.filter((s) => s.def.active).length} fonte(s) ativa(s)
          </span>
        </Card>
        {v.annual ? (
          <Card className="flex flex-col gap-1 p-4 sm:col-span-2">
            <span className="text-[13px] font-semibold text-ink-2">
              Ajuste anual estimado do IR {v.multipleClt ? '(vários vínculos CLT)' : ''}
            </span>
            {v.annual.annual.balance > 0 ? (
              <>
                <span className="text-xl font-extrabold">
                  A pagar: <Money cents={v.annual.annual.balance} />
                </span>
                <span className="text-xs text-ink-2">
                  Provisão sugerida:{' '}
                  <Money cents={v.annual.annual.monthlyProvision} className="font-bold" />
                  /mês.{' '}
                  {v.multipleClt
                    ? 'Cada folha aplica a faixa isenta e a redução sozinha; na declaração, as rendas se somam.'
                    : ''}
                </span>
              </>
            ) : (
              <span className="text-xl font-extrabold">
                {v.annual.annual.balance < 0 ? (
                  <>
                    A restituir: <Money cents={-v.annual.annual.balance} />
                  </>
                ) : (
                  'Sem imposto a pagar no ajuste'
                )}
              </span>
            )}
            <span className="text-xs text-ink-2">
              Estimativa com 12 meses do salário atual, sem 13º (tributação exclusiva) e sem outras
              deduções.
            </span>
          </Card>
        ) : null}
      </section>

      {v.sources.map((s) => (
        <Card key={s.def.id} className="flex flex-col gap-4" data-testid="income-source">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="mr-auto flex items-center gap-2">
              {s.def.name}
              <Pill className="bg-surface-2 text-ink-2">{TYPE_LABEL[s.def.type]}</Pill>
              {!s.def.active ? <Pill className="bg-surface-2 text-ink-3">encerrada</Pill> : null}
              {s.def.calibrationFactor !== 1 ? (
                <Pill className="bg-info-soft text-info-ink">
                  calibrada ×{s.def.calibrationFactor.toFixed(3).replace('.', ',')}
                </Pill>
              ) : null}
            </CardTitle>
            <DeleteButton kind="source" id={s.def.id} label={s.def.name} />
          </div>
          <p className="-mt-2 text-sm text-ink-2">
            {s.ruleText}
            {s.accountName ? ` · cai em ${s.accountName}` : ''} · desde {formatBR(s.def.startDate)}
            {s.def.endDate ? ` até ${formatBR(s.def.endDate)}` : ''}
          </p>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-extrabold tracking-wide text-ink-2 uppercase">
                Cálculo do mês
              </span>
              <table className="w-full text-sm">
                <tbody>
                  {s.calc.lines.map((l, i) => (
                    <tr key={i} className="border-t border-surface-2 first:border-t-0">
                      <td className="py-1.5">{l.label}</td>
                      <td className="py-1.5 text-right">
                        <Money cents={l.cents} signed={i > 0} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border font-extrabold">
                    <td className="py-1.5">Líquido</td>
                    <td className="py-1.5 text-right" data-testid="income-net">
                      <Money cents={s.calc.net} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-extrabold tracking-wide text-ink-2 uppercase">
                  Próximos pagamentos
                </span>
                {s.next.length === 0 ? (
                  <span className="text-sm text-ink-2">—</span>
                ) : (
                  <ul className="text-sm">
                    {s.next.map((n) => (
                      <li key={n.id} className="flex justify-between gap-2 py-0.5">
                        <span>
                          {formatBR(n.expectedDate as LocalDate)} ·{' '}
                          {n.label.replace(`${s.def.name} — `, '')}
                        </span>
                        <Money
                          cents={n.userOverrideCents ?? n.expectedCents}
                          className="font-bold"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-extrabold tracking-wide text-ink-2 uppercase">
                  Eventos
                </span>
                {s.def.events.length ? (
                  <ul className="text-sm">
                    {s.def.events.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2">
                        <span>
                          {INCOME_EVENT_LABEL[e.type]} · {formatBR(e.expectedDate)}
                          {e.vacationDays ? ` · ${e.vacationDays} dias` : ''}
                          {e.netCents != null ? (
                            <>
                              {' '}
                              · <Money cents={e.netCents} />
                            </>
                          ) : null}
                        </span>
                        <DeleteButton kind="event" id={e.id} label={INCOME_EVENT_LABEL[e.type]} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-sm text-ink-2">Nenhum (13º, férias, PLR, bônus).</span>
                )}
              </div>
            </div>
          </div>
          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-bold">Reajustes e histórico</summary>
            <div className="mt-3 flex flex-col gap-3">
              <ul className="text-sm">
                {s.history.map((h) => (
                  <li key={h.validFrom}>
                    <Money cents={h.grossCents} className="font-bold" /> desde{' '}
                    {formatBR(h.validFrom)}
                    {h.validTo ? ` até ${formatBR(h.validTo)}` : ' (vigente)'}
                  </li>
                ))}
              </ul>
              <SalaryChangeForm sourceId={s.def.id} today={v.today} />
            </div>
          </details>
          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-bold">Adicionar evento</summary>
            <div className="mt-3">
              <EventForm sourceId={s.def.id} type={s.def.type} year={year} />
            </div>
          </details>
          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-bold">Editar</summary>
            <div className="mt-3">
              <IncomeForm defaults={defaultsFor(s)} accounts={v.accounts} today={v.today} />
            </div>
          </details>
        </Card>
      ))}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardTitle>Nova fonte de renda</CardTitle>
          <IncomeForm accounts={v.accounts} today={v.today} />
        </Card>
        <Card className="flex flex-col gap-3 self-start">
          <CardTitle>Simulador de salário</CardTitle>
          <SalarySimulator
            tables={v.tables}
            currentGross={v.sources.find((s) => s.def.type === 'clt')?.gross ?? 0}
          />
        </Card>
      </div>
    </>
  );
}
