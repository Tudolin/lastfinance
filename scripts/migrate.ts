/**
 * Aplica as migrações pendentes. Usa a conexão direta (sem pooler), como o Neon recomenda.
 * Executado no build da Vercel (`vercel-build`) e em `pnpm db:migrate`.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

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
