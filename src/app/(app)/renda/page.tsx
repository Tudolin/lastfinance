import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Renda' };

export default function Page() {
  return (
    <ComingSoon
      title="Renda"
      phase={3}
      description="Fontes de renda CLT e PJ com calculadora de líquido (INSS, IRRF e Lei 15.270/2025), datas de pagamento por dia útil e conciliação previsto × realizado."
    />
  );
}
