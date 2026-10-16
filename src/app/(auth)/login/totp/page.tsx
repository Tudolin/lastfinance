import { AuthCard } from '@/components/auth/auth-card';
import { TotpForm } from './totp-form';

export const metadata = { title: 'Verificação em duas etapas' };

export default function TotpPage() {
  return (
    <AuthCard
      title="Verificação em duas etapas"
      subtitle="Digite o código de 6 dígitos do seu app autenticador."
    >
      <TotpForm />
    </AuthCard>
  );
}
