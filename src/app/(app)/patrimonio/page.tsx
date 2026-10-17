import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import { getWealthView } from '@/server/queries/wealth';

export const metadata = { title: 'Patrimônio' };

type Point = { date: string; netCents: number };

/** Linha simples da evolução (SVG no servidor, sem JS). */
function NetWorthChart({ points }: { points: Point[] }) {
  if (points.length < 2)
    return (
      <p className="text-sm text-ink-2">
        O gráfico aparece a partir do segundo dia: o app guarda um retrato do seu patrimônio todo
        dia.
      </p>
    );
  const W = 600;
  const H = 160;
  const values = points.map((p) => p.netCents);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min || 1)) * H;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.netCents).toFixed(1)}`);
  const first = points[0]!;
  const last = points.at(-1)!;
  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="money-sensitive h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Evolução do patrimônio de ${formatBR(first.date as LocalDate)} a ${formatBR(last.date as LocalDate)}`}
      >
        {min < 0 ? (
          <line
            x1="0"
            x2={W}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--border-strong)"
            strokeDasharray="4 4"
          />
        ) : null}
        <path d={`${d.join(' ')} L${W},${H} L0,${H} Z`} fill="var(--primary-soft)" stroke="none" />
        <path d={d.join(' ')} fill="none" stroke="var(--link)" strokeWidth="2.5" />
      </svg>
      <figcaption className="flex justify-between text-xs text-ink-2">
        <span>{formatBR(first.date as LocalDate)}</span>
        <span>{formatBR(last.date as LocalDate)}</span>
      </figcaption>
    </figure>
  );
}

function Change({
  label,
  change,
}: {
  label: string;
  change: { since: string; cents: number } | null;
}) {
  if (!change) return null;
  return (
    <span>
      {label} ({formatBR(change.since as LocalDate)}):{' '}
      <Money cents={change.cents} signed tone="auto" className="font-bold" />
    </span>
  );
}

export default async function WealthPage() {
  const v = await getWealthView();
  const n = v.now;
  const rows = [
    ...n.breakdown.accounts.map((a) => ({ ...a, group: 'Contas', sign: 1 })),
    ...n.breakdown.investments.map((a) => ({ ...a, group: 'Investimentos', sign: 1 })),
    ...n.breakdown.cards.map((a) => ({ ...a, group: 'Cartões (fatura em aberto)', sign: -1 })),
  ];
  const groups = ['Contas', 'Investimentos', 'Cartões (fatura em aberto)'] as const;
  return (
    <>
      <PageHeader title="Patrimônio" kicker="Tudo o que você tem, menos o que deve" />
      <Card
        className="flex flex-col gap-3 bg-primary text-primary-ink"
        aria-label="Patrimônio líquido"
      >
        <span className="text-sm font-bold text-hero-sub">Patrimônio líquido hoje</span>
        <span className="text-4xl font-extrabold" data-testid="net-worth">
          <Money cents={n.netCents} />
        </span>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-hero-sub">
          <span>
            Contas <Money cents={n.cashCents} />
          </span>
          <span>
            Investimentos <Money cents={n.investmentsCents} />
          </span>
          <span>
            Cartões −<Money cents={n.cardDebtCents} />
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Change label="Em 30 dias" change={v.change30d} />
          <Change label="Desde o início" change={v.changeSinceStart} />
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="flex flex-col gap-3 lg:col-span-2">
          <CardTitle>Evolução (12 meses)</CardTitle>
          <NetWorthChart points={v.history} />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle>Composição</CardTitle>
          {groups.map((g) => {
            const items = rows.filter((r) => r.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="flex flex-col">
                <span className="text-xs font-bold text-ink-2 uppercase">{g}</span>
                {items.map((r, i) => (
                  <div
                    key={`${r.name}-${i}`}
                    className="flex items-baseline justify-between gap-2 border-t border-surface-2 py-1.5 text-sm first:border-t-0"
                  >
                    <span>
                      {r.name}
                      {r.institution ? (
                        <span className="text-xs text-ink-2"> · {r.institution}</span>
                      ) : null}
                    </span>
                    <Money cents={r.sign * r.cents} signed={r.sign < 0} className="font-bold" />
                  </div>
                ))}
              </div>
            );
          })}
        </Card>
      </div>
      <p className="text-xs text-ink-2">
        Considera os saldos que os bancos informam. Bens (imóvel, carro) e dívidas fora do cartão
        não entram.
      </p>
    </>
  );
}
