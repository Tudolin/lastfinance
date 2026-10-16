import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Caixinhas' };

export default function Page() {
  return (
    <ComingSoon
      title="Caixinhas"
      phase={4}
      description="Rendimento por lote de aporte com IR regressivo e IOF, CDI automático do Banco Central, simulações e recomendação de aporte mensal."
    />
  );
}
