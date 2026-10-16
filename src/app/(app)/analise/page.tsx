import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { NATURE_LABEL, type Nature } from '@/domain/analysis/nature';
import { getNatureAnalysis } from '@/server/queries/planning';

export const metadata = { title: 'Fixas × variáveis' };

const NATURE_HELP: Record<Nature, string> = {
  fixed:
    'Mesmo valor (ou quase) todo mês: aluguel, internet, assinaturas, parcelas. Entram na previsão como planejado certo.',
  variable_recurring:
    'Todo mês, mas o valor oscila: mercado, combustível, delivery, luz. Entram na previsão pela média, com faixa.',
  eventual: 'Pontuais: viagem, eletrônicos, presentes.',
};

function pct(x: number | null) {
  return x == null ? '—' : `${Math.round(x * 100)}%`;
}

function explain(s: {
  monthsPresent: number;
  monthsObserved: number;
  cv: number;
  trend3: number | null;
}) {
  const parts = [
    `${s.monthsPresent} de ${s.monthsObserved} meses`,
    `variação ${Math.round(s.cv * 100)}%`,
  ];
  if (s.trend3 != null && Math.abs(s.trend3) >= 0.1)
    parts.push(
      `${s.trend3 > 0 ? '↑' : '↓'} ${Math.abs(Math.round(s.trend3 * 100))}% nos últimos 3 meses`,
    );
  return parts.join(' · ');
}

export default async function AnalysisPage() {
  const a = await getNatureAnalysis();
  const natures: Nature[] = ['fixed', 'variable_recurring', 'eventual'];
  return (
    <>
      <PageHeader title="Fixas × variáveis" />
      <p className="-mt-2 text-sm text-ink-2">
        Últimos 12 meses completos, por estabelecimento. A classificação é estatística (presença
        mensal e variação do valor); renda média no período: <Money cents={a.monthlyIncomeCents} />.
      </p>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {natures.map((n) => (
          <Card key={n} className="flex flex-col gap-1 p-4">
            <span className="text-[13px] font-semibold text-ink-2">{NATURE_LABEL[n]}</span>
            <Money cents={a.totals[n].avg12} className="text-xl font-extrabold" />
            <span className="text-xs text-ink-2">
              por mês (média 12m) · {pct(a.totals[n].shareOfIncome)} da renda · {a.totals[n].count}{' '}
              itens
            </span>
          </Card>
        ))}
      </section>
      {natures.map((n) => {
        const groups = a.groups.filter((g) => g.stats.nature === n);
        if (!groups.length) return null;
        return (
          <Card key={n} className="flex flex-col gap-2">
            <CardTitle>{NATURE_LABEL[n]}</CardTitle>
            <p className="text-sm text-ink-2">{NATURE_HELP[n]}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-ink-2 uppercase">
                    <th className="py-2 pr-2 font-bold">Estabelecimento</th>
                    <th className="p-2 text-right font-bold">Média 3m</th>
                    <th className="p-2 text-right font-bold">6m</th>
                    <th className="p-2 text-right font-bold">12m</th>
                    <th className="p-2 text-right font-bold">Mín – máx</th>
                    <th className="py-2 pl-2 text-right font-bold">% renda</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.slice(0, 40).map((g) => (
                    <tr key={g.key} className="border-t border-surface-2 align-top">
                      <td className="py-2 pr-2">
                        <span className="font-bold">{g.name}</span>
                        <span className="block text-xs text-ink-2">
                          {g.categoryLabel ? `${g.categoryLabel} · ` : ''}
                          {explain(g.stats)}
                        </span>
                      </td>
                      <td className="p-2 text-right">
                        <Money cents={g.stats.avg3} />
                      </td>
                      <td className="p-2 text-right">
                        <Money cents={g.stats.avg6} />
                      </td>
                      <td className="p-2 text-right font-bold">
                        <Money cents={g.stats.avg12} />
                      </td>
                      <td className="p-2 text-right text-ink-2">
                        <Money cents={g.stats.minCents} /> – <Money cents={g.stats.maxCents} />
                      </td>
                      <td className="py-2 pl-2 text-right">{pct(g.shareOfIncome)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </>
  );
}
