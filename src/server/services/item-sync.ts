import 'server-only';
import { addDays, todaySP, type LocalDate } from '@/domain/dates/local-date';
import type { JobStep } from '@/server/jobs/step';
import { log } from '@/server/log';
import { postprocess } from './postprocess';
import {
  finishSyncLog,
  markConnectionSynced,
  markMissingAsDeleted,
  refreshConnection,
  startSyncLog,
  syncAccounts,
  syncBills,
  syncInvestments,
  syncTransactionsPage,
  type SyncTrigger,
} from './sync';

/** Carga inicial: o máximo que a Pluggy fornece (12 meses). */
export const BACKFILL_DAYS = 365;
/**
 * Sync incremental relê uma janela de 40 dias: a Pluggy atualiza transações antigas (7–365 dias)
 * só semanalmente, e mudanças/exclusões nessa faixa precisam ser vistas.
 */
export const INCREMENTAL_DAYS = 40;
const MAX_PAGES_PER_ACCOUNT = 200;

export type ItemSyncInput = { pluggyItemId: string; mode: 'backfill' | 'incremental'; trigger: SyncTrigger; runId: string };

/**
 * Sincroniza um item inteiro em passos curtos e retomáveis:
 * item → contas → (por conta) páginas de transações → limpeza → faturas → investimentos → pós-processamento.
 * Cada página de transações é um passo próprio, então a carga histórica nunca estoura o tempo de uma função.
 */
export async function runItemSync(step: JobStep, input: ItemSyncInput) {
  const today: LocalDate = todaySP();
  const from = addDays(today, -(input.mode === 'backfill' ? BACKFILL_DAYS : INCREMENTAL_DAYS));

  const conn = await step.run('refresh-item', async () => {
    const c = await refreshConnection(input.pluggyItemId);
    return { id: c.id, status: c.status, backfillState: c.backfillState };
  });
  const mode = conn.backfillState !== 'done' ? 'backfill' : input.mode;
  const effectiveFrom = mode === 'backfill' ? addDays(today, -BACKFILL_DAYS) : from;

  const logId = await step.run('log-start', () =>
    startSyncLog({ connectionId: conn.id, trigger: input.trigger, job: `item:${mode}`, runId: input.runId }),
  );

  const counts = { transactions: 0, inserted: 0, updated: 0, deleted: 0, bills: 0, investments: 0, pages: 0 };
  try {
    const accounts = await step.run('accounts', () => syncAccounts(conn.id));

    for (const acc of accounts) {
      let after: string | null = null;
      let page = 0;
      do {
        const r: Awaited<ReturnType<typeof syncTransactionsPage>> = await step.run(`tx:${acc.id}:${page}`, () =>
          syncTransactionsPage(acc, { dateFrom: effectiveFrom, after }, input.runId),
        );
        counts.transactions += r.count;
        counts.inserted += r.inserted;
        counts.updated += r.updated + r.reattached;
        counts.pages++;
        after = r.next;
        page++;
      } while (after && page < MAX_PAGES_PER_ACCOUNT);

      counts.deleted += await step.run(`gc:${acc.id}`, () => markMissingAsDeleted(acc.id, effectiveFrom, input.runId));
      if (acc.kind === 'credit_card') counts.bills += await step.run(`bills:${acc.id}`, () => syncBills(acc));
    }

    counts.investments = await step.run('investments', () => syncInvestments(conn.id));
    await step.run('postprocess', () => postprocess(today));
    await step.run('log-finish', async () => {
      await markConnectionSynced(conn.id, mode === 'backfill');
      await finishSyncLog(logId, { status: 'success', counts });
    });
    log.info('sync concluído', { itemId: input.pluggyItemId, runId: input.runId, mode, ...counts });
    return counts;
  } catch (err) {
    await finishSyncLog(logId, {
      status: 'error',
      counts,
      errorCode: (err as { code?: string }).code ?? (err as Error).name,
      errorMessage: (err as Error).message?.slice(0, 300) ?? null,
    });
    log.error('sync falhou', err, { itemId: input.pluggyItemId, runId: input.runId });
    throw err;
  }
}
