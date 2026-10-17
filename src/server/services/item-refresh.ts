import 'server-only';
import { isNull } from 'drizzle-orm';
import { getPluggy } from '@/server/adapters/pluggy/client';
import { getDb, schema } from '@/server/db/client';
import { log } from '@/server/log';
import { isMeuPluggy } from './pluggy-mapping';

/** Itens atualizados há menos que isso não pedem coleta nova (a Pluggy já fez a dela). */
export const REFRESH_MIN_AGE_HOURS = 20;

/** Estados em que pedir atualização não adianta: já está atualizando ou depende de você reconectar. */
const SKIP_STATUS = new Set(['UPDATING', 'LOGIN_ERROR', 'WAITING_USER_INPUT']);

export type RefreshCandidate = {
  pluggyItemId: string;
  connectorId: number;
  connectorName: string;
  status: string;
  pluggyLastUpdatedAt: Date | null;
};

export function dueForRefresh(items: RefreshCandidate[], now: Date): string[] {
  const minAge = REFRESH_MIN_AGE_HOURS * 3_600_000;
  return (
    items
      // A Pluggy recusa atualizar itens MeuPluggy (400 "MeuPluggy item cant be updated"): quem coleta é o MeuPluggy.
      .filter((i) => !isMeuPluggy({ id: i.connectorId, name: i.connectorName }))
      .filter((i) => !SKIP_STATUS.has(i.status))
      .filter(
        (i) => !i.pluggyLastUpdatedAt || now.getTime() - i.pluggyLastUpdatedAt.getTime() >= minAge,
      )
      .map((i) => i.pluggyItemId)
  );
}

/**
 * Pede à Pluggy uma coleta nova de cada item desatualizado. O resultado chega pelo webhook
 * `item/updated`, que dispara a sincronização. Usa a cota do Open Finance, por isso no máximo 1×/dia.
 */
export async function refreshStaleItems(now = new Date()) {
  const rows = await getDb()
    .select({
      pluggyItemId: schema.institutionConnection.pluggyItemId,
      connectorId: schema.institutionConnection.connectorId,
      connectorName: schema.institutionConnection.connectorName,
      status: schema.institutionConnection.status,
      pluggyLastUpdatedAt: schema.institutionConnection.pluggyLastUpdatedAt,
    })
    .from(schema.institutionConnection)
    .where(isNull(schema.institutionConnection.deletedAt));
  const due = dueForRefresh(rows, now);
  const pluggy = await getPluggy();
  let requested = 0;
  for (const itemId of due) {
    try {
      await pluggy.requestItemUpdate(itemId);
      requested++;
    } catch (err) {
      log.error('atualização diária recusada', err, { itemId });
    }
  }
  return { items: rows.length, requested, skipped: rows.length - due.length };
}
