import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { parts, todaySP } from '@/domain/dates/local-date';
import { monthName } from '@/lib/format';
import { cn } from '@/lib/cn';
import { getYearReport } from '@/server/queries/reports';
import { ReportNav } from '../report-nav';

export const metadata = { title: 'Visão anual' };

const short = (iso: string) => {
  const m = monthName(Number(iso.slice(5, 7)));
  return `${m[0]!.toUpperCase()}${m.slice(1, 3)}`;
};

export default async function YearReportPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>;
}) {
  const { y } = await searchParams;
  const current = parts(todaySP()).year;
  const year = y && /^\d{4}$/.test(y) && Number(y) <= current ? Number(y) : current;
  const r = await getYearReport(year);
  const maxBar = Math.max(1, ...r.months.flatMap((m) => [m.incomeCents, m.expenseCents]));
  const cell = 'px-2 py-1.5 text-right whitespace-nowrap';

  return (
    <>
      <PageHeader title="Relatórios" kicker="Visão anual">
        <ReportNav
          tab="ano"
          label={String(year)}
          prevHref={`/relatorios/anual?y=${year - 1}`}
          nextHref={year < current ? `/relatorios/anual?y=${year + 1}` : null}
          exportHref={`/api/exportar/transacoes?from=${year}-01-01&to=${year}-12-31`}
        />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl bg-surface-2 p-3">
          <span className="text-xs font-bold text-ink-2">Receitas no ano</span>
          <Money cents={r.total.incomeCents} className="block text-xl font-extrabold" />
        </div>
        <div className="rounded-xl bg-surface-2 p-3" data-testid="year-expense">
          <span className="text-xs font-bold text-ink-2">Gastos no ano</span>
          <Money cents={r.total.expenseCents} className="block text-xl font-extrabold" />
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <span className="text-xs font-bold text-ink-2">Sobrou</span>
          <Money cents={r.total.leftoverCents} className="block text-xl font-extrabold" />
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <span className="text-xs font-bold text-ink-2">Gasto médio por mês</span>
          <Money cents={r.averageExpenseCents} className="block text-xl font-extrabold" />
        </div>
      </div>

      <Card className="flex flex-col gap-3" aria-label="Mês a mês">
        <CardTitle>Mês a mês</CardTitle>
        {r.months.length === 0 ? (
          <p className="text-sm text-ink-2">Sem dados neste ano.</p>
        ) : (
          <>
            <div className="money-sensitive flex h-36 items-end gap-1.5" aria-hidden="true">
              {r.months.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-28 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/2 max-w-4 rounded-t bg-[#2e9a78]"
                      style={{ height: `${(Math.max(0, m.incomeCents) / maxBar) * 100}%` }}
                    />
                    <div
                      className="w-1/2 max-w-4 rounded-t bg-warn"
                      style={{ height: `${(Math.max(0, m.expenseCents) / maxBar) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-ink-2">{short(m.month)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 text-xs text-ink-2">
              <span className="flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-[#2e9a78]" /> Receitas
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-warn" /> Gastos
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-ink-2">
                    <th className="px-2 py-1.5 text-left">Mês</th>
                    <th className={cell}>Receitas</th>
                    <th className={cell}>Gastos</th>
                    <th className={cell}>Sobrou</th>
                    <th className={cell}>Aplicado</th>
                  </tr>
                </thead>
                <tbody>
                  {r.months.map((m) => (
                    <tr key={m.month} className="border-t border-surface-2">
                      <td className="px-2 py-1.5 font-bold">
                        <a href={`/relatorios?m=${m.month.slice(0, 7)}`} className="text-ink">
                          {short(m.month)}
                        </a>
                        {m.partial ? <span className="text-xs text-ink-2"> (parcial)</span> : null}
                      </td>
                      <td className={cell}>
                        <Money cents={m.incomeCents} />
                      </td>
                      <td className={cell}>
                        <Money cents={m.expenseCents} />
                      </td>
                      <td className={cn(cell, m.leftoverCents < 0 && 'text-danger')}>
                        <Money cents={m.leftoverCents} />
                      </td>
                      <td className={cell}>
                        <Money cents={m.investedCents} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border font-extrabold">
                    <td className="px-2 py-1.5">Total</td>
                    <td className={cell}>
                      <Money cents={r.total.incomeCents} />
                    </td>
                    <td className={cell}>
                      <Money cents={r.total.expenseCents} />
                    </td>
                    <td className={cell}>
                      <Money cents={r.total.leftoverCents} />
                    </td>
                    <td className={cell}>
                      <Money cents={r.total.investedCents} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {r.categories.length ? (
        <Card className="flex flex-col gap-3" aria-label="Categorias no ano">
          <CardTitle>Categorias no ano</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-ink-2">
                  <th className="sticky left-0 bg-surface px-2 py-1.5 text-left">Categoria</th>
                  {r.months.map((m) => (
                    <th key={m.month} className={cell}>
                      {short(m.month)}
                    </th>
                  ))}
                  <th className={cell}>Total</th>
                </tr>
              </thead>
              <tbody>
                {r.categories.slice(0, 15).map((c) => (
                  <tr key={c.label} className="border-t border-surface-2">
                    <td className="sticky left-0 bg-surface px-2 py-1.5 font-bold">{c.label}</td>
                    {c.byMonth.map((v, i) => (
                      <td key={i} className={cn(cell, v === 0 && 'text-ink-3')}>
                        {v ? <Money cents={v} /> : '—'}
                      </td>
                    ))}
                    <td className={cn(cell, 'font-extrabold')}>
                      <Money cents={c.totalCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
