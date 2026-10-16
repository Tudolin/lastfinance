/**
 * Sonda os seus itens reais na Pluggy e mostra QUAIS campos vêm preenchidos (nunca os valores).
 * Uso: PLUGGY_CLIENT_ID=… PLUGGY_CLIENT_SECRET=… pnpm pluggy:probe <itemId> [<itemId>…]
 * Cole a saída numa issue/conversa para ajustarmos o mapeamento ao dado real.
 */
import { PluggyClient } from 'pluggy-sdk';

const [, , ...itemIds] = process.argv;
const { PLUGGY_CLIENT_ID: id, PLUGGY_CLIENT_SECRET: secret } = process.env;
if (!id || !secret || itemIds.length === 0) {
  console.error('Uso: PLUGGY_CLIENT_ID=… PLUGGY_CLIENT_SECRET=… pnpm pluggy:probe <itemId> [...]');
  process.exit(1);
}
const sdk = new PluggyClient({ clientId: id, clientSecret: secret });

/** Mostra a forma do objeto: tipo de cada campo e se está preenchido. */
function shape(o: unknown, depth = 0): unknown {
  if (o === null || o === undefined) return 'null';
  if (o instanceof Date) return 'Date';
  if (Array.isArray(o)) return o.length ? [shape(o[0], depth + 1), `…${o.length} itens`] : '[]';
  if (typeof o === 'object') {
    if (depth > 3) return '{…}';
    return Object.fromEntries(
      Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, shape(v, depth + 1)]),
    );
  }
  return typeof o;
}

function fillRate(rows: Record<string, unknown>[], paths: string[]) {
  const get = (r: unknown, p: string) =>
    p.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | null)?.[k], r);
  return Object.fromEntries(
    paths.map((p) => [p, `${rows.filter((r) => get(r, p) != null).length}/${rows.length}`]),
  );
}

for (const itemId of itemIds) {
  const item = await sdk.fetchItem(itemId);
  console.log(
    `\n══ Item ${itemId}: ${item.connector.name} (connector ${item.connector.id}, Open Finance: ${String((item.connector as { isOpenFinance?: boolean }).isOpenFinance)})`,
  );
  console.log(
    'status:',
    item.status,
    '| execution:',
    item.executionStatus,
    '| consentExpiresAt:',
    item.consentExpiresAt ? 'sim' : 'não',
    '| products:',
    JSON.stringify((item.connector as { products?: string[] }).products),
  );
  const accounts = (await sdk.fetchAccounts(itemId)).results;
  for (const a of accounts) {
    console.log(`\n── Conta ${a.type}/${a.subtype} "${a.name}"`);
    console.log('creditData:', JSON.stringify(shape(a.creditData)));
    const txs = (
      await sdk.fetchTransactionsCursor(a.id, {
        dateFrom: new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10),
      })
    ).results;
    const dates = txs.map((t) => new Date(t.date).toISOString());
    console.log(
      `transações (1ª página): ${txs.length} | mais antiga: ${dates.sort()[0]?.slice(0, 10) ?? '—'} | horários: ${[...new Set(dates.map((d) => d.slice(11)))].slice(0, 5).join(', ')}`,
    );
    console.log(
      'preenchimento:',
      fillRate(txs as unknown as Record<string, unknown>[], [
        'status',
        'providerId',
        'providerCode',
        'operationType',
        'descriptionRaw',
        'category',
        'paymentData',
        'paymentData.payer.documentNumber.value',
        'paymentData.receiver.documentNumber.value',
        'creditCardMetadata',
        'creditCardMetadata.billId',
        'creditCardMetadata.installmentNumber',
        'creditCardMetadata.purchaseDate',
      ]),
    );
    console.log('sinais:', {
      debitoNegativo: txs.filter((t) => t.type === 'DEBIT' && t.amount < 0).length,
      debitoPositivo: txs.filter((t) => t.type === 'DEBIT' && t.amount > 0).length,
      creditoNegativo: txs.filter((t) => t.type === 'CREDIT' && t.amount < 0).length,
    });
    if (a.type === 'CREDIT') {
      const bills = (await sdk.fetchCreditCardBills(a.id)).results;
      console.log(`faturas: ${bills.length}`, bills[0] ? JSON.stringify(shape(bills[0])) : '');
    }
  }
  try {
    const inv = (await sdk.fetchInvestments(itemId)).results;
    console.log(`\n── Investimentos: ${inv.length}`);
    for (const i of inv)
      console.log(
        `  ${i.type}/${i.subtype ?? '—'} "${i.name}" rateType=${i.rateType ?? '—'} rate=${i.rate != null ? 'sim' : 'não'} issueDate=${i.issueDate ? 'sim' : 'não'}`,
      );
  } catch (e) {
    console.log('investimentos: erro', (e as Error).message);
  }
}
