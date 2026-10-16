import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Previsão de caixa' };

export default function Page() {
  return (
    <ComingSoon
      title="Previsão de caixa"
      phase={3}
      description="Saldo projetado dia a dia para 30, 60 e 90 dias, com receitas previstas, recorrências, faturas e parcelas futuras, faixa de incerteza e o dia de menor saldo."
    />
  );
}
