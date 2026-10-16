/** Zera o banco de E2E antes de subir o servidor (nunca rode contra um banco real). */
import { Client } from 'pg';

const url = process.env.DATABASE_URL!;
if (!/_e2e\b|lastfinance_e2e/.test(url)) {
  console.error(
    'reset-db: recusando zerar um banco que não é de E2E:',
    url.replace(/:[^:@/]+@/, ':***@'),
  );
  process.exit(1);
}
const c = new Client({ connectionString: url });
await c.connect();
await c.query(
  'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
);
await c.end();
console.log('Banco de E2E zerado.');
