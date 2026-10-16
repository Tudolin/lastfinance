import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { PasskeyLoginButton } from '@/components/auth/passkey-login-button';
import { getCurrentSession } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { LoginForm } from './login-form';

export const metadata = { title: 'Entrar' };

export default async function LoginPage() {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.appUser);
  if ((r?.n ?? 0) === 0) redirect('/setup');
  const s = await getCurrentSession();
  if (s) redirect(s.locked ? '/unlock' : '/');
  return (
    <AuthCard title="Entrar" subtitle="Use a digital ou sua senha.">
      <PasskeyLoginButton />
      <div className="flex items-center gap-3 text-xs font-bold text-ink-3">
        <span className="h-px flex-1 bg-border" />
        ou
        <span className="h-px flex-1 bg-border" />
      </div>
      <LoginForm />
    </AuthCard>
  );
}
