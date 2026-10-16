import 'server-only';
import { getDb, schema } from '@/server/db/client';
import { parseSettings, type UserSettings } from '@/server/auth/settings';

/** App single-user: jobs em segundo plano leem as configurações do (único) usuário. */
export async function getAppSettings(): Promise<UserSettings> {
  const [u] = await getDb()
    .select({ settings: schema.appUser.settings })
    .from(schema.appUser)
    .limit(1);
  return parseSettings(u?.settings);
}
