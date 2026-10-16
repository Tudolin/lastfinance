/**
 * Pluggy falsa e determinística (PRNG com semente) para desenvolvimento, testes e E2E.
 * Gera ~12 meses de Nubank + Itaú (conta e cartão) com os casos que o app precisa tratar:
 * salário, aluguel, Pix entre contas próprias, pagamento de fatura, caixinha, parcelado e estorno.
 * Convenções de sinal iguais às da Pluggy real: conta → DEBIT negativo; cartão → compra positiva.
 */
import {
  addDays,
  addMonths,
  clampedDate,
  parts,
  ymd,
  type LocalDate,
} from '@/domain/dates/local-date';
import { bankingCalendar } from '@/domain/dates/business-days';
import type {
  PluggyAccount,
  PluggyBill,
  PluggyGateway,
  PluggyInvestment,
  PluggyInvestmentTx,
  PluggyItem,
  PluggyTransaction,
  TransactionQuery,
} from './types';

export const FAKE_OWN_CPF = '12345678909';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (d: LocalDate) => new Date(`${d}T00:00:00.000Z`);

type StoredTx = PluggyTransaction & { createdAt: Date };

export class FakePluggy implements PluggyGateway {
  items = new Map<string, PluggyItem>();
  accounts = new Map<string, PluggyAccount>();
  txs = new Map<string, StoredTx>();
  bills = new Map<string, PluggyBill[]>();
  investments = new Map<string, PluggyInvestment[]>();
  investmentTxs = new Map<string, PluggyInvestmentTx[]>();
  pageSize = 500;
  updateRequests: string[] = [];
  private seq = 0;

  constructor(
    readonly today: LocalDate,
    private readonly rand = mulberry32(42),
  ) {}

  // ───────── API (PluggyGateway) ─────────

  async fetchItem(itemId: string) {
    const it = this.items.get(itemId);
    if (!it) throw Object.assign(new Error('Item not found'), { status: 404 });
    return it;
  }

  async fetchAccounts(itemId: string) {
    return [...this.accounts.values()].filter((a) => a.itemId === itemId);
  }

  async fetchTransactionsPage(accountId: string, q: TransactionQuery) {
    let list = [...this.txs.values()].filter((t) => t.accountId === accountId);
    if (q.ids) list = list.filter((t) => q.ids!.includes(t.id));
    if (q.dateFrom) list = list.filter((t) => t.date.toISOString().slice(0, 10) >= q.dateFrom!);
    if (q.createdAtFrom) list = list.filter((t) => t.createdAt >= new Date(q.createdAtFrom!));
    list.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.id < b.id ? -1 : 1));
    const offset = q.after ? Number(q.after) : 0;
    const page = list.slice(offset, offset + this.pageSize);
    const nextOffset = offset + this.pageSize;
    return {
      results: page.map(({ createdAt: _c, ...t }) => t),
      next: nextOffset < list.length ? String(nextOffset) : null,
    };
  }

  async fetchBills(accountId: string) {
    return this.bills.get(accountId) ?? [];
  }

  async fetchInvestments(itemId: string) {
    return this.investments.get(itemId) ?? [];
  }

  async fetchInvestmentTransactions(investmentId: string) {
    return this.investmentTxs.get(investmentId) ?? [];
  }

  async createConnectToken() {
    return 'fake-connect-token';
  }

  async requestItemUpdate(itemId: string) {
    this.updateRequests.push(itemId);
  }

  // ───────── Mutação (testes e conexão falsa) ─────────

  nextId(prefix: string) {
    this.seq++;
    return `${prefix}-${String(this.seq).padStart(5, '0')}`;
  }

  addTx(
    t: Omit<
      PluggyTransaction,
      | 'id'
      | 'currencyCode'
      | 'status'
      | 'descriptionRaw'
      | 'providerCode'
      | 'providerId'
      | 'operationType'
      | 'paymentData'
      | 'creditCardMetadata'
    > &
      Partial<PluggyTransaction>,
    createdAt = new Date(),
  ): StoredTx {
    const tx: StoredTx = {
      id: t.id ?? this.nextId('tx'),
      currencyCode: 'BRL',
      status: 'POSTED',
      descriptionRaw: null,
      providerCode: null,
      providerId: null,
      operationType: null,
      paymentData: null,
      creditCardMetadata: null,
      createdAt,
      ...t,
    };
    this.txs.set(tx.id, tx);
    return tx;
  }

  deleteTx(id: string) {
    this.txs.delete(id);
  }

  /** Simula a Pluggy apagando e recriando com outro id (mudança grande de data/valor/descrição). */
  changeTxId(id: string): string {
    const t = this.txs.get(id)!;
    this.txs.delete(id);
    const nid = this.nextId('tx');
    this.txs.set(nid, { ...t, id: nid });
    return nid;
  }

  setItemStatus(
    itemId: string,
    status: string,
    error: { code: string; message: string } | null = null,
  ) {
    const it = this.items.get(itemId)!;
    this.items.set(itemId, { ...it, status, error, executionStatus: error ? 'ERROR' : 'SUCCESS' });
  }

  // ───────── Geração de dados ─────────

  /** Cria um item com contas e histórico sintético. */
  seedInstitution(kind: 'nubank' | 'itau', months = 12): string {
    const itemId = `fake-item-${kind}`;
    const isNu = kind === 'nubank';
    this.items.set(itemId, {
      id: itemId,
      connector: {
        id: isNu ? 601 : 602,
        name: isNu ? 'Nubank' : 'Itaú',
        imageUrl: null,
        isOpenFinance: true,
      },
      status: 'UPDATED',
      executionStatus: 'SUCCESS',
      statusDetail: null,
      error: null,
      consentExpiresAt: at(addMonths(this.today, 11)),
      lastUpdatedAt: at(this.today),
      nextAutoSyncAt: null,
    });
    const checking = `${itemId}-checking`;
    const card = `${itemId}-card`;
    const closingDay = isNu ? 3 : 28;
    const dueDay = isNu ? 10 : 5;
    this.accounts.set(checking, {
      id: checking,
      itemId,
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      number: isNu ? '0001/1234567-8' : '1234/56789-0',
      balance: 0,
      name: isNu ? 'Conta Nubank' : 'Conta Itaú',
      marketingName: null,
      taxNumber: FAKE_OWN_CPF,
      currencyCode: 'BRL',
      creditData: null,
    });
    this.accounts.set(card, {
      id: card,
      itemId,
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      number: isNu ? '5162' : '4321',
      balance: 0,
      name: isNu ? 'Nubank Mastercard' : 'Itaú Visa',
      marketingName: null,
      taxNumber: FAKE_OWN_CPF,
      currencyCode: 'BRL',
      creditData: {
        balanceCloseDate: at(
          clampedDate(parts(this.today).year, parts(this.today).month, closingDay),
        ),
        balanceDueDate: at(clampedDate(parts(this.today).year, parts(this.today).month, dueDay)),
        availableCreditLimit: isNu ? 5484.2 : 4087.52,
        creditLimit: isNu ? 8000 : 5000,
        minimumPayment: null,
      },
    });

    const start = addMonths(this.today, -months);
    const r = this.rand;
    let balance = isNu ? 1500 : 3000;
    const cardPurchases: {
      date: LocalDate;
      amount: number;
      desc: string;
      inst?: [number, number];
    }[] = [];

    for (let m = 0; m <= months; m++) {
      const base = addMonths(start, m);
      const { year, month } = parts(base);
      const inMonth = (day: number) => clampedDate(year, month, day);
      const add = (
        date: LocalDate,
        amount: number,
        description: string,
        extra: Partial<PluggyTransaction> = {},
      ) => {
        if (date > this.today || date < start) return;
        balance += amount;
        this.addTx(
          {
            accountId: checking,
            date: at(date),
            description,
            type: amount < 0 ? 'DEBIT' : 'CREDIT',
            amount,
            ...extra,
          },
          at(date),
        );
      };

      if (!isNu) {
        add(bankingCalendar.nthBusinessDay(year, month, 5), 6127.3, 'SALARIO ACME LTDA');
        add(inMonth(1), -2100, 'PIX ENVIADO IMOBILIARIA BOA VISTA', {
          paymentData: {
            receiver: { documentNumber: { value: '11222333000181', type: 'CNPJ' } },
            payer: undefined,
          },
        });
        add(inMonth(8), -129.9, 'DEB AUT VIVO FIBRA');
        // Pix para o Nubank (conta própria) — o par fica no Nubank
        const tdate = bankingCalendar.nthBusinessDay(year, month, 6);
        add(tdate, -2500, 'PIX TRANSF ENVIADA NU PAGAMENTOS', {
          paymentData: {
            receiver: { documentNumber: { value: FAKE_OWN_CPF, type: 'CPF' } },
            payer: undefined,
          },
        });
        add(inMonth(12), -45.5 - Math.round(r() * 3000) / 100, 'PADARIA SAO JORGE');
      } else {
        const tdate = bankingCalendar.nthBusinessDay(year, month, 6);
        add(tdate, 2500, 'Transferência recebida pelo Pix', {
          paymentData: {
            payer: { documentNumber: { value: FAKE_OWN_CPF, type: 'CPF' } },
            receiver: undefined,
          },
        });
        add(inMonth(14), -500, 'Aplicação RDB');
        if (month % 3 === 0) add(inMonth(20), 300, 'Resgate RDB');
      }

      // compras no cartão
      const purchases: [string, number, number][] = isNu
        ? [
            ['IFD*IFOOD', 4, 3],
            ['UBER *TRIP', 3, 4],
            ['MERCADO EXTRA', 1, 4],
            ['NETFLIX.COM', 1, 0],
          ]
        : [
            ['POSTO SHELL', 1, 2],
            ['DROGASIL', 1, 1],
          ];
      for (const [desc, n, spread] of purchases) {
        for (let k = 0; k < n; k++) {
          const day = desc.startsWith('NETFLIX') ? 15 : 1 + Math.floor(r() * 27);
          const amount = desc.startsWith('NETFLIX')
            ? 55.9
            : Math.round((20 + r() * (spread * 60 + 40)) * 100) / 100;
          cardPurchases.push({ date: inMonth(day), amount, desc });
        }
      }
    }

    if (!isNu) {
      // notebook em 10x no Itaú, comprado há 2 meses
      const buy = addMonths(this.today, -2);
      for (let k = 1; k <= 10; k++) {
        cardPurchases.push({
          date: addMonths(buy, k - 1),
          amount: 412.5,
          desc: `NOTEBOOK DELL ${String(k).padStart(2, '0')}/10`,
          inst: [k, 10],
        });
      }
    } else {
      // compra + estorno
      const d1 = addDays(this.today, -14);
      cardPurchases.push({ date: d1, amount: 89.9, desc: 'AMAZON MARKETPLACE' });
      cardPurchases.push({
        date: addDays(d1, 11),
        amount: -89.9,
        desc: 'Estorno AMAZON MARKETPLACE',
      });
    }

    // fatura por ciclo
    const bills: PluggyBill[] = [];
    const cycleOf = (d: LocalDate) => {
      const { year, month } = parts(d);
      let close = clampedDate(year, month, closingDay);
      if (d >= close) close = addMonths(close, 1);
      close = clampedDate(parts(close).year, parts(close).month, closingDay);
      const due =
        dueDay > closingDay
          ? clampedDate(parts(close).year, parts(close).month, dueDay)
          : clampedDate(parts(addMonths(close, 1)).year, parts(addMonths(close, 1)).month, dueDay);
      return { close, due };
    };
    const byCycle = new Map<string, { close: LocalDate; due: LocalDate; total: number }>();
    for (const p of cardPurchases) {
      if (p.date > this.today || p.date < start) continue;
      const c = cycleOf(p.date);
      const billId = `${card}-bill-${c.close}`;
      const agg = byCycle.get(billId) ?? { ...c, total: 0 };
      agg.total = Math.round((agg.total + p.amount) * 100) / 100;
      byCycle.set(billId, agg);
      this.addTx(
        {
          accountId: card,
          date: at(p.date),
          description: p.desc,
          type: p.amount > 0 ? 'DEBIT' : 'CREDIT',
          amount: p.amount,
          creditCardMetadata: {
            billId,
            purchaseDate: at(p.date),
            ...(p.inst ? { installmentNumber: p.inst[0], totalInstallments: p.inst[1] } : {}),
          },
        },
        at(p.date),
      );
    }
    for (const [billId, c] of [...byCycle.entries()].sort()) {
      const paid = c.due <= this.today;
      bills.push({
        id: billId,
        dueDate: at(c.due),
        billClosingDate: at(c.close),
        totalAmount: c.total,
        minimumPaymentAmount: Math.round(c.total * 15) / 100,
        allowsInstallments: true,
        financeCharges: [],
        payments: paid
          ? [{ paymentDate: at(c.due), amount: c.total, valueType: 'FULL_PAYMENT' }]
          : [],
      });
      if (paid && c.close <= this.today) {
        // pagamento: débito na conta corrente + crédito no cartão
        balance -= c.total;
        this.addTx(
          {
            accountId: checking,
            date: at(c.due),
            description: isNu ? 'Pagamento de fatura' : 'ITAU CARTOES PAGTO FATURA',
            type: 'DEBIT',
            amount: -c.total,
          },
          at(c.due),
        );
        this.addTx(
          {
            accountId: card,
            date: at(c.due),
            description: 'Pagamento recebido',
            type: 'CREDIT',
            amount: -c.total,
            creditCardMetadata: { billId },
          },
          at(c.due),
        );
      }
    }
    this.bills.set(card, bills);
    const acc = this.accounts.get(checking)!;
    this.accounts.set(checking, { ...acc, balance: Math.round(balance * 100) / 100 });
    const open = bills
      .filter((b) => b.dueDate > at(this.today))
      .reduce((s, b) => s + b.totalAmount, 0);
    const cardAcc = this.accounts.get(card)!;
    this.accounts.set(card, { ...cardAcc, balance: Math.round(open * 100) / 100 });

    if (isNu) {
      const invId = `${itemId}-cdb-reserva`;
      this.investments.set(itemId, [
        {
          id: invId,
          itemId,
          type: 'FIXED_INCOME',
          subtype: 'CDB',
          name: 'Caixinha Reserva de emergência',
          issuer: 'Nu Financeira',
          rate: 100,
          rateType: 'CDI',
          fixedAnnualRate: null,
          amount: 21900,
          balance: 21760,
          taxes: 140,
          amountProfit: 1260,
          issueDate: at(start),
          dueDate: null,
          status: 'ACTIVE',
        },
      ]);
      this.investmentTxs.set(invId, []);
    }
    return itemId;
  }
}

let singleton: FakePluggy | undefined;

/** Instância compartilhada do modo PLUGGY_FAKE (dev/E2E): nasce vazia; "conectar" cria os itens. */
export function getFakePluggy(): FakePluggy {
  if (!singleton) {
    const now = new Date();
    singleton = new FakePluggy(ymd(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()));
  }
  return singleton;
}
