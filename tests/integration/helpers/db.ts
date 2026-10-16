import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { setDbForTests, type Db } from '@/server/db/client';
import * as schema from '@/server/db/schema';

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: 'drizzle' });
  setDbForTests(db as unknown as Db);
  return { db: db as unknown as Db, close: () => client.close() };
}
