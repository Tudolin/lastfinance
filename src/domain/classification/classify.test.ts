import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BusinessCalendar } from '../dates/business-days';
import { addDays, localDate as d, type LocalDate } from '../dates/local-date';
import { classifyTransactions } from './classify';
import { looksLikeInvestmentIn, looksLikeInvestmentOut, cardPaymentTextStrength } from './patterns';
import type {
  ClassifiableAccount,
  ClassifiableBill,
  ClassifiableTx,
  ClassifyInput,
  TxKind,
} from './types';

const calendar = new BusinessCalendar();
const accounts: ClassifiableAccount[] = [
  { id: 'itau', kind: 'checking' },
  { id: 'nu', kind: 'checking' },
  { id: 'nu-card', kind: 'credit_card' },
  { id: 'itau-card', kind: 'credit_card' },
];
const OWN = 'hash-do-meu-cpf';

let seq = 0;
function tx(
  p: Partial<ClassifiableTx> & Pick<ClassifiableTx, 'accountId' | 'amountCents'>,
): ClassifiableTx {
  seq++;
  return {
    id: p.id ?? `t${String(seq).padStart(4, '0')}`,
    date: d('2026-10-14'),
    description: 'X',
    ...p,
  };
}

function run(
  transactions: ClassifiableTx[],
  bills: ClassifiableBill[] = [],
  extra: Partial<ClassifyInput> = {},
) {
  return classifyTransactions({
    accounts,
    transactions,
    bills,
    ownDocHashes: new Set([OWN]),
    calendar,
    ...extra,
  });
}

describe('transferências entre contas próprias', () => {
  it('pareia Itaú → Nubank (mesmo valor, sinais opostos, mesmo dia)', () => {
    const out = tx({
      id: 'o',
      accountId: 'itau',
      amountCents: -150000,
      description: 'PIX TRANSF ENVIADA',
    });
    const inn = tx({
      id: 'i',
      accountId: 'nu',
      amountCents: 150000,
      description: 'Transferência recebida pelo Pix',
    });
    const r = run([out, inn]);
    expect(r.get('o')).toMatchObject({ kind: 'internal_transfer', linkedTransactionId: 'i' });
    expect(r.get('i')).toMatchObject({ kind: 'internal_transfer', linkedTransactionId: 'o' });
  });

  it('aceita datas próximas atravessando fim de semana (sexta → segunda)', () => {
    const out = tx({
      id: 'o',
      accountId: 'itau',
      amountCents: -50000,
      date: d('2026-10-09'),
      description: 'TED',
    });
    const inn = tx({
      id: 'i',
      accountId: 'nu',
      amountCents: 50000,
      date: d('2026-10-13'),
      description: 'TED recebida',
    });
    expect(run([out, inn]).get('o')?.kind).toBe('internal_transfer');
  });

  it('não pareia se a distância passa de 2 dias úteis', () => {
    const out = tx({
      id: 'o',
      accountId: 'itau',
      amountCents: -50000,
      date: d('2026-10-05'),
      description: 'PIX',
    });
    const inn = tx({
      id: 'i',
      accountId: 'nu',
      amountCents: 50000,
      date: d('2026-10-09'),
      description: 'PIX',
    });
    const r = run([out, inn]);
    expect(r.get('o')?.kind).toBe('expense');
    expect(r.get('i')?.kind).toBe('income');
  });

  it('não pareia valores diferentes nem a mesma conta', () => {
    const r = run([
      tx({ id: 'a', accountId: 'itau', amountCents: -10000, description: 'PIX' }),
      tx({ id: 'b', accountId: 'nu', amountCents: 10001, description: 'PIX' }),
      tx({ id: 'c', accountId: 'nu', amountCents: -20000, description: 'PIX' }),
      tx({ id: 'e', accountId: 'nu', amountCents: 20000, description: 'PIX' }),
    ]);
    expect([...r.values()].some((c) => c.kind === 'internal_transfer')).toBe(false);
  });

  it('sem pista textual nem documento, mesmo valor coincidente vira só candidato fraco', () => {
    const r = run([
      tx({
        id: 'o',
        accountId: 'itau',
        amountCents: -10000,
        description: 'Pagamento boleto condominio',
      }),
      tx({ id: 'i', accountId: 'nu', amountCents: 10000, description: 'Recebimento' }),
    ]);
    // score base 0,5 passa o limiar, mas com confiança baixa (vai para revisão)
    expect(r.get('o')?.kind).toBe('internal_transfer');
    expect(r.get('o')!.confidence).toBeLessThan(0.7);
  });

  it('documento próprio da contraparte reforça e resolve ambiguidade 2×1', () => {
    const out = tx({
      id: 'o',
      accountId: 'itau',
      amountCents: -30000,
      description: 'PIX ENVIADO',
      counterpartyDocHash: OWN,
    });
    const inA = tx({
      id: 'ia',
      accountId: 'nu',
      amountCents: 30000,
      description: 'PIX RECEBIDO',
      counterpartyDocHash: 'outro',
    });
    const inB = tx({
      id: 'ib',
      accountId: 'nu',
      amountCents: 30000,
      description: 'PIX RECEBIDO',
      counterpartyDocHash: OWN,
    });
    const r = run([out, inA, inB]);
    // o par em que as duas pontas confirmam o documento próprio vence; a outra entrada é receita
    expect(r.get('o')!.linkedTransactionId).toBe('ib');
    expect(r.get('ia')?.kind).toBe('income');
  });

  it('transferência para conta própria não conectada (documento = meu)', () => {
    const r = run([
      tx({
        id: 'o',
        accountId: 'itau',
        amountCents: -99900,
        description: 'PIX ENVIADO',
        counterpartyDocHash: OWN,
      }),
    ]);
    expect(r.get('o')).toMatchObject({ kind: 'internal_transfer', linkedTransactionId: null });
  });

  it('marcação manual de transferência ganha o par automaticamente', () => {
    const r = run([
      tx({
        id: 'o',
        accountId: 'itau',
        amountCents: -12345,
        description: 'qualquer',
        userKind: 'internal_transfer',
      }),
      tx({
        id: 'i',
        accountId: 'nu',
        amountCents: 12345,
        description: 'outra coisa',
        date: d('2026-10-15'),
      }),
    ]);
    expect(r.get('o')).toMatchObject({
      kind: 'internal_transfer',
      source: 'user',
      linkedTransactionId: 'i',
    });
    expect(r.get('i')).toMatchObject({
      kind: 'internal_transfer',
      source: 'auto',
      linkedTransactionId: 'o',
    });
  });
});

describe('pagamento de fatura', () => {
  const bill: ClassifiableBill = {
    id: 'bill-out',
    accountId: 'nu-card',
    dueDate: d('2026-10-10'),
    totalCents: 231844,
    minimumCents: 34777,
    paymentsCents: [],
  };

  it('descrição forte + valor da fatura → card_payment ligado à fatura e ao crédito no cartão', () => {
    const bank = tx({
      id: 'b',
      accountId: 'nu',
      amountCents: -231844,
      date: d('2026-10-10'),
      description: 'Pagamento de fatura',
    });
    const card = tx({
      id: 'c',
      accountId: 'nu-card',
      amountCents: 231844,
      date: d('2026-10-10'),
      description: 'Pagamento recebido',
    });
    const r = run([bank, card], [bill]);
    expect(r.get('b')).toMatchObject({
      kind: 'card_payment',
      paidBillId: 'bill-out',
      linkedTransactionId: 'c',
    });
    expect(r.get('c')).toMatchObject({ kind: 'card_payment', linkedTransactionId: 'b' });
  });

  it('pagamento do mínimo também é reconhecido', () => {
    const r = run(
      [
        tx({
          id: 'b',
          accountId: 'itau',
          amountCents: -34777,
          date: d('2026-10-09'),
          description: 'ITAU CARTOES',
        }),
      ],
      [bill],
    );
    expect(r.get('b')).toMatchObject({ kind: 'card_payment', paidBillId: 'bill-out' });
  });

  it('texto fraco ("FATURA") sozinho não basta — boleto de telefone continua despesa', () => {
    const r = run(
      [
        tx({
          id: 'b',
          accountId: 'itau',
          amountCents: -9990,
          description: 'PAGTO BOLETO FATURA CLARO',
        }),
      ],
      [bill],
    );
    expect(r.get('b')?.kind).toBe('expense');
  });

  it('texto fraco + valor/data da fatura confirma', () => {
    const r = run(
      [
        tx({
          id: 'b',
          accountId: 'itau',
          amountCents: -231844,
          date: d('2026-10-08'),
          description: 'BOLETO FATURA',
        }),
      ],
      [bill],
    );
    expect(r.get('b')?.kind).toBe('card_payment');
  });

  it('valor igual à fatura mas sem texto e fora da janela → despesa comum', () => {
    const r = run(
      [
        tx({
          id: 'b',
          accountId: 'itau',
          amountCents: -231844,
          date: d('2026-11-20'),
          description: 'Loja',
        }),
      ],
      [bill],
    );
    expect(r.get('b')?.kind).toBe('expense');
  });

  it('nunca conta em dobro: despesas = compras do cartão + débitos, sem o pagamento da fatura', () => {
    const txs = [
      tx({ id: 'p1', accountId: 'nu-card', amountCents: -100000, description: 'Mercado' }),
      tx({ id: 'p2', accountId: 'nu-card', amountCents: -131844, description: 'Farmácia' }),
      tx({
        id: 'b',
        accountId: 'nu',
        amountCents: -231844,
        date: d('2026-10-10'),
        description: 'Pagamento de fatura',
      }),
      tx({
        id: 'c',
        accountId: 'nu-card',
        amountCents: 231844,
        date: d('2026-10-10'),
        description: 'Pagamento recebido',
      }),
      tx({ id: 'd1', accountId: 'itau', amountCents: -5000, description: 'Padaria' }),
    ];
    const r = run(txs, [bill]);
    const spending = txs
      .filter((t) => r.get(t.id)!.kind === 'expense')
      .reduce((s, t) => s + t.amountCents, 0);
    expect(spending).toBe(-100000 - 131844 - 5000);
  });

  it('sem nenhum cartão cadastrado, não existe pagamento de fatura', () => {
    const r = classifyTransactions({
      accounts: [{ id: 'itau', kind: 'checking' }],
      transactions: [
        tx({ id: 'b', accountId: 'itau', amountCents: -1000, description: 'Pagamento de fatura' }),
      ],
      bills: [],
      ownDocHashes: new Set(),
      calendar,
    });
    expect(r.get('b')?.kind).toBe('expense');
  });
});

describe('investimentos (caixinhas)', () => {
  it('aplicação e resgate não são despesa nem receita', () => {
    const r = run([
      tx({ id: 'a', accountId: 'nu', amountCents: -80000, description: 'Aplicação RDB' }),
      tx({ id: 'b', accountId: 'nu', amountCents: 20000, description: 'Resgate RDB' }),
      tx({ id: 'c', accountId: 'itau', amountCents: -50000, description: 'APLIC AUT MAIS' }),
      tx({
        id: 'e',
        accountId: 'nu',
        amountCents: 10000,
        description: 'Dinheiro resgatado da caixinha',
      }),
    ]);
    expect(r.get('a')?.kind).toBe('investment_in');
    expect(r.get('b')?.kind).toBe('investment_out');
    expect(r.get('c')?.kind).toBe('investment_in');
    expect(r.get('e')?.kind).toBe('investment_out');
  });

  it('padrões textuais', () => {
    expect(looksLikeInvestmentIn('Guardado na caixinha Viagem')).toBe(true);
    expect(looksLikeInvestmentOut('Resgate pontos Livelo')).toBe(false);
    expect(cardPaymentTextStrength('Pagamento de fatura')).toBe(2);
    expect(cardPaymentTextStrength('FATURA CLARO')).toBe(1);
    expect(cardPaymentTextStrength('Uber')).toBe(0);
  });
});

describe('estornos', () => {
  it('crédito no cartão vira estorno ligado à compra original', () => {
    const r = run([
      tx({
        id: 'p',
        accountId: 'nu-card',
        amountCents: -8990,
        date: d('2026-10-02'),
        description: 'AMAZON MARKETPLACE',
      }),
      tx({
        id: 'q',
        accountId: 'nu-card',
        amountCents: -1000,
        date: d('2026-10-03'),
        description: 'UBER',
      }),
      tx({
        id: 'r',
        accountId: 'nu-card',
        amountCents: 8990,
        date: d('2026-10-13'),
        description: 'Estorno AMAZON MARKETPLACE',
      }),
    ]);
    expect(r.get('r')).toMatchObject({ kind: 'refund', refundOfTransactionId: 'p' });
  });

  it('estorno parcial também liga; estorno sem compra parecida fica sem vínculo', () => {
    const r = run([
      tx({
        id: 'p',
        accountId: 'nu-card',
        amountCents: -20000,
        date: d('2026-10-01'),
        description: 'LOJA RENNER',
      }),
      tx({
        id: 'r1',
        accountId: 'nu-card',
        amountCents: 5000,
        date: d('2026-10-05'),
        description: 'ESTORNO LOJA RENNER',
      }),
      tx({
        id: 'r2',
        accountId: 'nu-card',
        amountCents: 777,
        date: d('2026-10-05'),
        description: 'CREDITO PROMOCIONAL',
      }),
    ]);
    expect(r.get('r1')?.refundOfTransactionId).toBe('p');
    expect(r.get('r2')).toMatchObject({ kind: 'refund', refundOfTransactionId: null });
  });

  it('estorno não liga a compra posterior a ele', () => {
    const r = run([
      tx({
        id: 'r',
        accountId: 'nu-card',
        amountCents: 5000,
        date: d('2026-10-01'),
        description: 'ESTORNO LOJA',
      }),
      tx({
        id: 'p',
        accountId: 'nu-card',
        amountCents: -5000,
        date: d('2026-10-05'),
        description: 'LOJA',
      }),
    ]);
    expect(r.get('r')?.refundOfTransactionId).toBeNull();
  });

  it('devolução na conta corrente vira estorno, não receita', () => {
    const r = run([
      tx({ id: 'r', accountId: 'itau', amountCents: 4590, description: 'DEVOLUCAO PIX' }),
    ]);
    expect(r.get('r')?.kind).toBe('refund');
  });
});

describe('precedência', () => {
  it('usuário > regra > automático', () => {
    const r = run([
      tx({
        id: 'u',
        accountId: 'itau',
        amountCents: -1000,
        description: 'Pagamento de fatura',
        userKind: 'expense',
        ruleKind: 'adjustment',
      }),
      tx({
        id: 'r',
        accountId: 'itau',
        amountCents: -1000,
        description: 'Pagamento de fatura',
        ruleKind: 'adjustment',
      }),
    ]);
    expect(r.get('u')).toMatchObject({ kind: 'expense', source: 'user', confidence: 1 });
    expect(r.get('r')).toMatchObject({ kind: 'adjustment', source: 'rule' });
  });
});

describe('propriedades', () => {
  const kinds: TxKind[] = ['expense', 'income', 'internal_transfer'];
  const arbTx = fc.record({
    accountId: fc.constantFrom('itau', 'nu', 'nu-card', 'itau-card'),
    amountCents: fc.integer({ min: -50000, max: 50000 }).filter((v) => v !== 0),
    day: fc.integer({ min: 0, max: 20 }),
    description: fc.constantFrom(
      'PIX',
      'TED',
      'Mercado',
      'Pagamento de fatura',
      'Estorno',
      'Aplicação RDB',
      'Salário',
    ),
    own: fc.boolean(),
    user: fc.option(fc.constantFrom(...kinds), { nil: undefined }),
  });

  type Row = typeof arbTx extends fc.Arbitrary<infer T> ? T : never;
  const build = (rows: Row[]) =>
    rows.map((r, i): ClassifiableTx => ({
      id: `p${String(i).padStart(3, '0')}`,
      accountId: r.accountId,
      amountCents: r.amountCents,
      date: addDays(d('2026-10-01'), r.day) as LocalDate,
      description: r.description,
      counterpartyDocHash: r.own ? OWN : null,
      userKind: r.user ?? null,
    }));

  it('toda transação recebe exatamente uma classificação; pares são simétricos e 1:1', () => {
    fc.assert(
      fc.property(fc.array(arbTx, { maxLength: 40 }), (rows) => {
        const txs = build(rows);
        const r = run(txs);
        expect(r.size).toBe(txs.length);
        const seen = new Set<string>();
        for (const t of txs) {
          const c = r.get(t.id)!;
          if (c.kind === 'internal_transfer' && c.linkedTransactionId) {
            const other = r.get(c.linkedTransactionId)!;
            expect(other.linkedTransactionId).toBe(t.id);
            expect(other.kind).toBe('internal_transfer');
            const peer = txs.find((x) => x.id === c.linkedTransactionId)!;
            expect(peer.amountCents).toBe(-t.amountCents);
            expect(peer.accountId).not.toBe(t.accountId);
            expect(seen.has(t.id)).toBe(false);
            seen.add(t.id);
          }
          if (t.userKind) expect(c.kind).toBe(t.userKind);
        }
      }),
    );
  });

  it('a soma das transferências pareadas é zero', () => {
    fc.assert(
      fc.property(fc.array(arbTx, { maxLength: 40 }), (rows) => {
        const txs = build(rows);
        const r = run(txs);
        const sum = txs
          .filter(
            (t) => r.get(t.id)!.kind === 'internal_transfer' && r.get(t.id)!.linkedTransactionId,
          )
          .reduce((s, t) => s + t.amountCents, 0);
        expect(sum).toBe(0);
      }),
    );
  });

  it('é determinística independentemente da ordem de entrada', () => {
    fc.assert(
      fc.property(fc.array(arbTx, { maxLength: 30 }), fc.integer(), (rows, seed) => {
        const txs = build(rows);
        const shuffled = [...txs].sort(
          (a, b) => ((a.id.charCodeAt(3) * seed) % 7) - ((b.id.charCodeAt(3) * seed) % 7),
        );
        const a = run(txs);
        const b = run(shuffled);
        for (const t of txs) expect(b.get(t.id)).toEqual(a.get(t.id));
      }),
    );
  });

  it('compras no cartão são sempre despesa (sem decisão do usuário)', () => {
    fc.assert(
      fc.property(fc.array(arbTx, { maxLength: 30 }), (rows) => {
        const txs = build(rows).map((t) => ({ ...t, userKind: null }));
        const r = run(txs);
        for (const t of txs) {
          if ((t.accountId === 'nu-card' || t.accountId === 'itau-card') && t.amountCents < 0) {
            expect(r.get(t.id)?.kind).toBe('expense');
          }
        }
      }),
    );
  });
});
