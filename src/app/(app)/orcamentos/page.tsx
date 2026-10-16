import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Orçamentos' };

export default function Page() {
  return (
    <ComingSoon
      title="Orçamentos"
      phase={2}
      description="Orçamento mensal por categoria, com ritmo de gasto, alertas aos 80% e 100% e sobra transferível para o mês seguinte."
    />
  );
}
