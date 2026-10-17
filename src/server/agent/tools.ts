import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { centsToReais } from '@/domain/agent/reais';
import { TX_KINDS } from '@/domain/classification/types';
import {
  addMonths,
  endOfMonth,
  localDate,
  startOfMonth,
  todaySP,
  type LocalDate,
} from '@/domain/dates/local-date';
import { toCents } from '@/domain/money';
import { foldText } from '@/domain/text/normalize';
import { getBalances, getOpenBills } from '@/server/queries/accounts';
import { categoryBreakdown, getCategories } from '@/server/queries/categories';
import {
  getForecastView,
  getMonthlyPlanVsActual,
  simulatePurchase,
} from '@/server/queries/forecast';
import { getIncomeView, getPlannedView, getRecurringView } from '@/server/queries/income';
import { getBudgets, getCardsOverview, getNatureAnalysis } from '@/server/queries/planning';
import { listTransactions, summarize } from '@/server/queries/transactions';

/**
 * Ferramentas do assistente. Todas só leem dados, pelas mesmas consultas das telas: a IA nunca tem
 * um caminho próprio para calcular. Valores voltam em reais (ver `centsToReais`).
 */
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Data no formato AAAA-MM-DD');
const month = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .describe('Mês no formato AAAA-MM');
const basis = z
  .enum(['cash', 'accrual'])
  .default('accrual')
  .describe(
    'accrual = competência (compra no cartão conta no dia da compra; padrão para "quanto gastei"); cash = caixa (cartão conta no vencimento da fatura)',
  );

type ToolDef<S extends z.ZodType> = {
  name: string;
  label: string;
  description: string;
  input: S;
  run: (input: z.infer<S>) => Promise<unknown>;
};

const tool = <S extends z.ZodType>(t: ToolDef<S>) => t;

async function resolveCategory(nameOrSlug: string) {
  const cats = await getCategories();
  const q = foldText(nameOrSlug);
  return (
    cats.find((c) => c.slug === nameOrSlug) ??
    cats.find((c) => foldText(c.name) === q) ??
    cats.find((c) => foldText(c.label).includes(q)) ??
    null
  );
}

export const TOOLS = [
  tool({
    name: 'get_overview',
    label: 'Consultando saldos e o mês',
    description:
      'Visão geral agora: saldo em conta (caixa), saldos por conta, investimentos, limites e faturas abertas dos cartões, e receita/gasto do mês atual até hoje. Use como ponto de partida para perguntas gerais.',
    input: z.object({}),
    run: async () => {
      const today = todaySP();
      const [balances, bills, month] = await Promise.all([
        getBalances(),
        getOpenBills(today),
        summarize(startOfMonth(today), today, 'accrual'),
      ]);
      return { today, ...balances, openBills: bills, currentMonthSoFar: month };
    },
  }),
  tool({
    name: 'get_spending_by_category',
    label: 'Somando gastos por categoria',
    description:
      'Gasto líquido por categoria num período (despesas menos estornos; transferências entre contas próprias, pagamento de fatura e aplicações não contam). Use para "quanto gastei com X", "onde mais gastei", comparações entre meses.',
    input: z.object({ from: date, to: date, basis }),
    run: async ({ from, to, basis }) => {
      const [rows, cats, totals] = await Promise.all([
        categoryBreakdown(from, to, basis),
        getCategories(true),
        summarize(from, to, basis),
      ]);
      return {
        period: { from, to, basis },
        totals,
        categories: rows
          .map((r) => ({
            category: cats.find((c) => c.id === r.categoryId)?.label ?? 'Sem categoria',
            cents: r.cents,
            transactions: r.count,
          }))
          .sort((a, b) => b.cents - a.cents),
      };
    },
  }),
  tool({
    name: 'get_monthly_history',
    label: 'Montando o histórico mensal',
    description:
      'Receita, gasto e valor aplicado mês a mês nos últimos N meses (inclui o mês atual, parcial). Use para tendências, médias e "quanto sobrou".',
    input: z.object({ months: z.number().int().min(1).max(24).default(6), basis }),
    run: async ({ months, basis }) => {
      const today = todaySP();
      const out = [];
      for (let i = months - 1; i >= 0; i--) {
        const start = addMonths(startOfMonth(today), -i);
        const end = i === 0 ? today : endOfMonth(start);
        const s = await summarize(start, end, basis);
        out.push({
          month: start.slice(0, 7),
          partial: i === 0,
          ...s,
          leftoverCents: s.incomeCents - s.expenseCents,
        });
      }
      return { basis, months: out };
    },
  }),
  tool({
    name: 'search_transactions',
    label: 'Buscando transações',
    description:
      'Lista transações com filtros (texto na descrição, período, categoria, tipo, faixa de valor). Devolve no máximo `limit` itens, mais recentes primeiro, e o total somado dos itens devolvidos. Valores negativos são saídas.',
    input: z.object({
      text: z.string().max(100).optional().describe('Trecho da descrição, ex.: "ifood"'),
      from: date.optional(),
      to: date.optional(),
      category: z.string().optional().describe('Nome ou slug da categoria'),
      kind: z.enum(TX_KINDS).optional(),
      minAmount: z.number().nonnegative().optional().describe('Valor absoluto mínimo, em reais'),
      maxAmount: z.number().nonnegative().optional().describe('Valor absoluto máximo, em reais'),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    run: async (i) => {
      const cat = i.category ? await resolveCategory(i.category) : null;
      if (i.category && !cat) return { error: `Categoria "${i.category}" não encontrada` };
      const { rows, hasMore } = await listTransactions({
        q: i.text,
        from: i.from,
        to: i.to,
        category: cat?.id,
        kind: i.kind,
        min: i.minAmount,
        max: i.maxAmount,
        basis: 'accrual',
        page: 1,
      });
      const cats = await getCategories(true);
      const list = rows.slice(0, i.limit);
      return {
        category: cat?.label,
        count: list.length,
        more: hasMore || rows.length > i.limit,
        totalCents: list.reduce((s, r) => s + r.amountCents, 0),
        transactions: list.map((r) => ({
          date: r.purchaseDate,
          description: r.description,
          amountCents: r.amountCents,
          kind: r.kind,
          category: cats.find((c) => c.id === r.categoryId)?.label ?? null,
          account: `${r.accountName} (${r.institution})`,
          installment: r.installmentTotal ? `${r.installmentNumber}/${r.installmentTotal}` : null,
        })),
      };
    },
  }),
  tool({
    name: 'get_budgets',
    label: 'Conferindo orçamentos',
    description:
      'Orçamentos do mês por categoria: limite, gasto, quanto resta, projeção para o fim do mês no ritmo atual e status.',
    input: z.object({ month: month.optional().describe('Padrão: mês atual') }),
    run: async ({ month }) => {
      const m = month ?? todaySP().slice(0, 7);
      const rows = await getBudgets(localDate(`${m}-01`));
      return {
        month: m,
        budgets: rows.map((b) => ({ category: b.label, rollover: b.rollover, ...b.pace })),
      };
    },
  }),
  tool({
    name: 'get_cards',
    label: 'Olhando os cartões',
    description:
      'Cartões de crédito: limite, disponível, fechamento, vencimento, fatura atual, últimas faturas, parcelas futuras e comprometimento da renda nos próximos meses.',
    input: z.object({}),
    run: async () => {
      const v = await getCardsOverview();
      return {
        monthlyIncomeCents: v.monthlyIncomeCents,
        cards: v.cards.map((c) => ({
          name: c.name,
          institution: c.institution,
          closingDay: c.closingDay,
          dueDay: c.dueDay,
          creditLimitCents: c.creditLimitCents,
          availableLimitCents: c.availableLimitCents,
          currentBill: c.currentBill && {
            dueDate: c.currentBill.dueDate,
            closingDate: c.currentBill.closingDate,
            totalCents: c.currentBill.totalCents,
            status: c.currentBill.status,
          },
          recentBills: c.recentBills.map((b) => ({ dueDate: b.dueDate, totalCents: b.totalCents })),
        })),
        commitment: v.commitment,
      };
    },
  }),
  tool({
    name: 'get_forecast',
    label: 'Calculando a previsão de caixa',
    description:
      'Previsão do saldo em conta dia a dia (renda, contas fixas, faturas, parcelas, gastos planejados e média de variáveis): menor saldo, saldo final, dias negativos, cenários conservador e otimista, "livre para gastar por dia", próximos lançamentos e saldo por semana.',
    input: z.object({ days: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(60) }),
    run: async ({ days }) => {
      const v = await getForecastView(days);
      const weekly = v.daily.filter((_, i) => i % 7 === 0 || i === v.daily.length - 1);
      const b = (x: { date: string; balance: number }) => ({
        date: x.date,
        balanceCents: x.balance,
      });
      return {
        today: v.today,
        horizonDays: days,
        startBalanceCents: v.startBalance,
        reserveCents: v.reserveCents,
        variableMonthlyCents: v.variableMonthlyCents,
        nextIncome: v.nextIncome,
        freePerDay: { cents: v.free.cents, until: v.free.until },
        base: {
          min: b(v.base.min),
          endCents: v.base.end,
          negativeDays: v.base.negativeDays,
          firstNegative: v.base.firstNegative,
        },
        conservative: {
          min: b(v.conservative.min),
          endCents: v.conservative.end,
          negativeDays: v.conservative.negativeDays,
        },
        optimistic: { min: b(v.optimistic.min), endCents: v.optimistic.end },
        upcoming: v.upcoming
          .slice(0, 25)
          .map((e) => ({ date: e.day, label: e.label, cents: e.cents })),
        weeklyBalance: weekly.map(b),
      };
    },
  }),
  tool({
    name: 'can_i_spend',
    label: 'Simulando a compra',
    description:
      'Simula uma compra na previsão de caixa e devolve o veredito (ok, warn = cabe com cuidado, no = melhor não), os motivos, o menor saldo antes e depois e quando cada parcela sai do caixa. Use sempre que perguntarem se podem comprar/gastar algo.',
    input: z.object({
      amount: z.number().positive().describe('Valor total em reais'),
      method: z.enum(['pix', 'debit', 'credit']).default('pix'),
      installments: z.number().int().min(1).max(48).default(1),
      date: date.optional().describe('Padrão: hoje'),
      description: z.string().max(80).optional(),
    }),
    run: async (i) => {
      const r = await simulatePurchase({
        amountCents: toCents(i.amount),
        method: i.method,
        installments: i.method === 'credit' ? i.installments : 1,
        date: (i.date ?? todaySP()) as LocalDate,
        description: i.description,
        accountId: null,
      });
      return {
        verdict: r.verdict,
        reasons: r.reasons,
        reserveCents: r.reserveCents,
        before: { minBalance: r.before.min, endCents: r.before.end },
        after: {
          minBalance: r.after.min,
          endCents: r.after.end,
          firstNegative: r.after.firstNegative,
        },
        conservativeMin: r.conservativeMin,
        cashOutflows: r.purchaseEvents,
      };
    },
  }),
  tool({
    name: 'get_plan_vs_actual',
    label: 'Comparando previsto e realizado',
    description:
      'Tabela mensal Previsto × Realizado (3 meses para trás, o atual e 2 à frente): renda prevista e recebida, gastos planejados e casados, gasto total e itens atrasados.',
    input: z.object({}),
    run: async () => {
      const rows = await getMonthlyPlanVsActual();
      return rows.map((r) => ({
        month: r.month,
        isCurrent: r.isCurrent,
        isFuture: r.isFuture,
        incomePlannedCents: r.income.planned,
        incomeActualCents: r.income.actual,
        plannedExpensesCents: r.plannedExpenses.planned,
        plannedExpensesMatchedCents: r.plannedExpenses.matched,
        totalExpensesCents: r.totalExpenses,
        lateItems: r.late,
      }));
    },
  }),
  tool({
    name: 'get_income_and_commitments',
    label: 'Lendo renda e compromissos',
    description:
      'Fontes de renda (bruto, líquido estimado, próximos pagamentos), recorrências confirmadas (contas fixas e assinaturas, com total mensal) e gastos planejados futuros.',
    input: z.object({}),
    run: async () => {
      const [income, recurring, planned] = await Promise.all([
        getIncomeView(),
        getRecurringView(),
        getPlannedView(),
      ]);
      return {
        income: {
          totalNetMonthlyCents: income.totalNet,
          sources: income.sources.map((s) => ({
            name: s.def.name,
            type: s.def.type,
            active: s.def.active,
            grossCents: s.gross,
            netCents: Math.round(s.calc.net * s.def.calibrationFactor),
            paymentRule: s.ruleText,
            next: s.next.map((n) => ({ date: n.cashDate, cents: n.expectedCents })),
          })),
        },
        recurring: {
          monthlyOutCents: recurring.monthlyOut,
          confirmed: recurring.confirmed.map((r) => ({
            name: r.name,
            direction: r.direction,
            amountCents: r.amountCents,
            periodicity: r.periodicity,
            category: r.categoryLabel,
          })),
          suggestedCount: recurring.suggested.length,
        },
        planned: planned.items
          .filter((p) => p.date >= todaySP())
          .slice(0, 20)
          .map((p) => ({
            description: p.description,
            date: p.date,
            amountCents: p.amountCents,
            method: p.paymentMethod,
            installments: p.installments,
          })),
      };
    },
  }),
  tool({
    name: 'get_fixed_vs_variable',
    label: 'Separando fixas e variáveis',
    description:
      'Análise dos últimos 12 meses por estabelecimento: natureza (fixa, variável recorrente, eventual), médias de 3/6/12 meses, tendência e % da renda. Use para "onde posso cortar", "quais são minhas contas fixas", "o que aumentou".',
    input: z.object({ top: z.number().int().min(5).max(60).default(25) }),
    run: async ({ top }) => {
      const v = await getNatureAnalysis();
      return {
        monthlyIncomeCents: v.monthlyIncomeCents,
        totalsByNature: Object.fromEntries(
          Object.entries(v.totals).map(([k, t]) => [
            k,
            {
              count: t.count,
              avg3Cents: t.avg3,
              avg12Cents: t.avg12,
              shareOfIncome: t.shareOfIncome,
            },
          ]),
        ),
        groups: v.groups
          .sort((a, b) => b.stats.avg12 - a.stats.avg12)
          .slice(0, top)
          .map((g) => ({
            name: g.name,
            category: g.categoryLabel,
            nature: g.stats.nature,
            monthsPresent: g.stats.monthsPresent,
            avg3Cents: g.stats.avg3,
            avg6Cents: g.stats.avg6,
            avg12Cents: g.stats.avg12,
            trend3: g.stats.trend3,
            shareOfIncome: g.shareOfIncome,
          })),
      };
    },
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]['name'];

export function toolLabel(name: string) {
  return TOOLS.find((t) => t.name === name)?.label ?? 'Consultando os dados';
}

/** Definições no formato da API. Ordem fixa (faz parte do prefixo cacheado). */
export function apiTools(): Anthropic.Tool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.input, { io: 'input' }) as Anthropic.Tool.InputSchema,
  }));
}

/** Valida a entrada e executa. Erros voltam como texto para a IA (is_error), nunca derrubam o chat. */
export async function runTool(
  name: string,
  input: unknown,
): Promise<{ content: string; isError: boolean }> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: `Ferramenta desconhecida: ${name}`, isError: true };
  const parsed = (t.input as z.ZodType).safeParse(input ?? {});
  if (!parsed.success)
    return { content: `Entrada inválida: ${z.prettifyError(parsed.error)}`, isError: true };
  try {
    const out = await (t.run as (i: unknown) => Promise<unknown>)(parsed.data);
    return { content: JSON.stringify(centsToReais(out)), isError: false };
  } catch (e) {
    // redirect() do Next (app bloqueado) precisa subir
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    return { content: `Falha ao consultar: ${(e as Error).message}`, isError: true };
  }
}
