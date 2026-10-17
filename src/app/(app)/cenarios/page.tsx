import { PageHeader } from '@/components/shell/page-header';
import { todaySP } from '@/domain/dates/local-date';
import { FinancingSimulator } from './financing-client';

export const metadata = { title: 'Cenários' };

export default function ScenariosPage() {
  return (
    <>
      <PageHeader title="Cenários" kicker="E se eu financiar?" />
      <FinancingSimulator today={todaySP()} />
      <p className="text-xs text-ink-2">
        Para outros “e se” (trocar de emprego, uma nova conta fixa, uma compra parcelada grande),
        pergunte ao Assistente: ele simula na sua previsão de caixa.
      </p>
    </>
  );
}
