import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Assistente' };

export default function Page() {
  return (
    <ComingSoon
      title="Assistente"
      phase={6}
      description="Chat em português sobre as suas finanças, com números sempre calculados pelo app, simulação de cenários (ex.: financiar um carro) e insights mensais."
    />
  );
}
