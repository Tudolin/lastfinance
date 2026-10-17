import 'server-only';
import { PluggyClient } from 'pluggy-sdk';
import { z } from 'zod';
import { env } from '@/lib/env';
import {
  parseAfterCursor,
  pluggyAccountSchema,
  pluggyBillSchema,
  pluggyInvestmentSchema,
  pluggyInvestmentTxSchema,
  pluggyItemSchema,
  pluggyTransactionSchema,
  type PluggyGateway,
} from './types';

const PAGE_SIZE = 500; // máximo aceito pela API (acima disso responde 400)

/** Busca todas as páginas de um endpoint paginado por número de página. */
async function allPages<T>(
  fetchPage: (page: number) => Promise<{ results: T[]; totalPages: number }>,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const r = await fetchPage(page);
    out.push(...r.results);
    if (page >= r.totalPages || r.results.length === 0) break;
    page++;
  }
  return out;
}

/**
 * Implementação real. O SDK guarda a apiKey e renova antes de expirar (2h) e já faz retry em 429;
 * aqui só validamos a forma dos dados.
 */
export class PluggySdkGateway implements PluggyGateway {
  private readonly sdk: PluggyClient;

  constructor(clientId: string, clientSecret: string) {
    this.sdk = new PluggyClient({ clientId, clientSecret });
  }

  async fetchItem(itemId: string) {
    return pluggyItemSchema.parse(await this.sdk.fetchItem(itemId));
  }

  async fetchAccounts(itemId: string) {
    const r = await this.sdk.fetchAccounts(itemId);
    return z.array(pluggyAccountSchema).parse(r.results);
  }

  async fetchTransactionsPage(
    accountId: string,
    q: { dateFrom?: string; createdAtFrom?: string; ids?: string[]; after?: string | null },
  ) {
    const r = await this.sdk.fetchTransactionsCursor(accountId, {
      ...(q.dateFrom ? { dateFrom: q.dateFrom } : {}),
      ...(q.createdAtFrom ? { createdAtFrom: q.createdAtFrom } : {}),
      ...(q.ids ? { ids: q.ids } : {}),
      ...(q.after ? { after: q.after } : {}),
    });
    return {
      results: z.array(pluggyTransactionSchema).parse(r.results),
      next: parseAfterCursor(r.next),
    };
  }

  async fetchBills(accountId: string) {
    const all = await allPages((page) =>
      this.sdk.fetchCreditCardBills(accountId, { page, pageSize: PAGE_SIZE }),
    );
    return z.array(pluggyBillSchema).parse(all);
  }

  async fetchInvestments(itemId: string) {
    const all = await allPages((page) =>
      this.sdk.fetchInvestments(itemId, undefined, { page, pageSize: PAGE_SIZE }),
    );
    return z.array(pluggyInvestmentSchema).parse(all);
  }

  async fetchInvestmentTransactions(investmentId: string) {
    const all = await allPages((page) =>
      this.sdk.fetchInvestmentTransactions(investmentId, { page, pageSize: PAGE_SIZE }),
    );
    return z.array(pluggyInvestmentTxSchema).parse(all);
  }

  async createConnectToken(opts: { itemId?: string; webhookUrl?: string }) {
    const r = await this.sdk.createConnectToken(opts.itemId, {
      ...(opts.webhookUrl ? { webhookUrl: opts.webhookUrl } : {}),
      avoidDuplicates: true,
    });
    return r.accessToken;
  }

  async requestItemUpdate(itemId: string) {
    await this.sdk.updateItem(itemId);
  }

  async listWebhooks() {
    const r = await this.sdk.fetchWebhooks();
    return r.results.map((w) => ({ id: w.id, url: w.url, event: w.event }));
  }

  async createWebhook(url: string, headers: Record<string, string>) {
    const w = await this.sdk.createWebhook('all', url, headers);
    return { id: w.id, url: w.url, event: w.event };
  }

  async deleteWebhook(id: string) {
    await this.sdk.deleteWebhook(id);
  }
}

let gateway: PluggyGateway | undefined;

export async function getPluggy(): Promise<PluggyGateway> {
  if (gateway) return gateway;
  const e = env();
  if (e.PLUGGY_FAKE) {
    const { getFakePluggy } = await import('./fake');
    return (gateway = getFakePluggy());
  }
  if (!e.PLUGGY_CLIENT_ID || !e.PLUGGY_CLIENT_SECRET) {
    throw new Error(
      'PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET não configurados (ou use PLUGGY_FAKE=true)',
    );
  }
  return (gateway = new PluggySdkGateway(e.PLUGGY_CLIENT_ID, e.PLUGGY_CLIENT_SECRET));
}

export function setPluggyForTests(g: PluggyGateway | undefined): void {
  gateway = g;
}
