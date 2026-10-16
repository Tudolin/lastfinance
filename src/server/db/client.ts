import 'server-only';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '@/lib/env';
import * as schema from './schema';

export type Schema = typeof schema;
/** Tipo comum a node-postgres (produção) e PGlite (testes). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

let db: Db | undefined;
let pool: Pool | undefined;

export function getDb(): Db {
  if (db) return db;
  pool = new Pool({
    connectionString: env().DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  // Na Vercel (Fluid Compute), fecha conexões ociosas antes de a instância ser suspensa.
  if (process.env.VERCEL) {
    void import('@vercel/functions').then(({ attachDatabasePool }) => attachDatabasePool(pool!));
  }
  db = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Db;
  return db;
}

/** Testes de integração injetam um banco PGlite. */
export function setDbForTests(testDb: Db | undefined): void {
  db = testDb;
}

export { schema };
