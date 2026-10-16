import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { getDb, schema } from '@/server/db/client';
import { SetupForm } from './setup-form';

export const metadata = { title: 'Primeiro acesso' };

export default async function SetupPage() {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.appUser);
  if ((r?.n ?? 0) > 0) redirect('/login');
  return (
    <AuthCard
      title="Primeiro acesso"
      subtitle="Crie o seu login. Depois você ativa a entrada com digital."
    >
      <SetupForm />
    </AuthCard>
  );
}
