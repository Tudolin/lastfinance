/**
 * Aplica as migrações pendentes. Usa a conexão direta (sem pooler), como o Neon recomenda.
 * Executado no build da Vercel (`vercel-build`) e em `pnpm db:migrate`.
 *
 * No build da Vercel, valida antes TODAS as variáveis que o app exige em execução: se faltar
 * alguma, o deploy falha aqui com a lista (só nomes e regras, nunca valores) em vez de subir um
 * site que dá erro em todas as páginas.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { checkEnv } from '../src/lib/env';

if (process.env.VERCEL) {
  const problems = checkEnv(process.env);
  if (problems.length) {
    console.error(
      [
        `Variáveis de ambiente faltando ou inválidas no ambiente "${process.env.VERCEL_ENV ?? '?'}":`,
        ...problems.map((p) => `  - ${p}`),
        'Corrija em Settings → Environment Variables (marque este ambiente) e faça Redeploy.',
        'Veja a tabela de variáveis no README.',
      ].join('\n'),
    );
    process.exit(1);
  }
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida');
  process.exit(1);
}
const client = new Client({ connectionString: url });
await client.connect();
await migrate(drizzle(client), { migrationsFolder: './drizzle' });
await client.end();
console.log('Migrações aplicadas.');
