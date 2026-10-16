import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Cartões' };

export default function Page() {
  return (
    <ComingSoon
      title="Cartões"
      phase={2}
      description="Fatura atual e próximas faturas com parcelas futuras, melhor dia de compra e quanto da renda futura já está comprometida."
    />
  );
}
