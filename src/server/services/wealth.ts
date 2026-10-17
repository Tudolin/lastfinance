import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { todaySP, type LocalDate } from '@/domain/dates/local-date';
import { getDb, schema } from '@/server/db/client';

const { account, institutionConnection, investment, netWorthSnapshot } = schema;

/**
 * Patrimônio agora: contas (exceto cartão) + investimentos − o que está em aberto nos cartões.
 * O saldo do cartão na Pluggy é o valor usado (positivo = dívida).
 */
export async function computeNetWorth() {
  const db = getDb();
  const [accts, invs] = await Promise.all([
    db
      .select({ a: account, institution: institutionConnection.connectorName })
      .from(account)
      .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
      .where(and(eq(account.isActive, true), isNull(institutionConnection.deletedAt))),
    db
      .select({
        id: investment.id,
        name: investment.name,
        issuer: investment.issuer,
        netCents: investment.netCents,
      })
      .from(investment)
      .where(isNull(investment.deletedAt)),
  ]);
  const bank = accts.filter((r) => r.a.kind !== 'credit_card');
  const cards = accts.filter((r) => r.a.kind === 'credit_card');
  const cashCents = bank.reduce((s, r) => s + r.a.balanceCents, 0);
  const investmentsCents = invs.reduce((s, i) => s + i.netCents, 0);
  const cardDebtCents = cards.reduce((s, r) => s + Math.max(0, r.a.balanceCents), 0);
  return {
    cashCents,
    investmentsCents,
    cardDebtCents,
    netCents: cashCents + investmentsCents - cardDebtCents,
    breakdown: {
      accounts: bank.map((r) => ({
        name: r.a.name,
        institution: r.institution,
        cents: r.a.balanceCents,
      })),
      investments: invs.map((i) => ({ name: i.name, institution: i.issuer, cents: i.netCents })),
      cards: cards.map((r) => ({
        name: r.a.name,
        institution: r.institution,
        cents: Math.max(0, r.a.balanceCents),
      })),
    },
  };
}

/** Grava (ou atualiza) o retrato do dia. */
export async function takeNetWorthSnapshot(date: LocalDate = todaySP()) {
  const nw = await computeNetWorth();
  const values = {
    date,
    cashCents: nw.cashCents,
    investmentsCents: nw.investmentsCents,
    cardDebtCents: nw.cardDebtCents,
    netCents: nw.netCents,
    breakdown: nw.breakdown,
  };
  await getDb()
    .insert(netWorthSnapshot)
    .values(values)
    .onConflictDoUpdate({
      target: netWorthSnapshot.date,
      set: { ...values, updatedAt: sql`now()` },
    });
  return nw;
}
