import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Posso gastar?' };

export default function Page() {
  return (
    <ComingSoon
      title="Posso gastar?"
      phase={3}
      description="Simule uma compra (valor, data, Pix/débito ou crédito e parcelas) e veja na hora se cabe, em qual fatura cai cada parcela e se fura a reserva mínima."
    />
  );
}
