import { addMonths, diffDays, type LocalDate } from '../dates/local-date';
import type { Cents } from '../money';
import { irr } from './irr';

/**
 * Financiamento pessoa física: tabela Price (parcelas iguais) ou SAC (amortização constante),
 * com IOF, seguro prestamista, tarifas e CET. Tudo em centavos inteiros.
 */
export type AmortizationSystem = 'price' | 'sac';

export type FinancingInput = {
  /** Valor financiado pedido (preço do bem − entrada). */
  principalCents: Cents;
  /** Juros ao mês, em % (ex.: 1.69). */
  monthlyRatePct: number;
  months: number;
  system: AmortizationSystem;
  contractDate: LocalDate;
  /** Vencimento da 1ª parcela (padrão: um mês após o contrato). */
  firstDueDate?: LocalDate;
  /** Seguro prestamista ao mês, em % do saldo devedor. */
  insuranceMonthlyPct?: number;
  /** Tarifas (cadastro, registro, avaliação). */
  feesCents?: Cents;
  /** Tarifas entram no valor financiado (padrão) ou são pagas à vista. */
  financeFees?: boolean;
  /** Cobrar IOF de pessoa física (padrão true), financiado junto. */
  iof?: boolean;
};

export type Installment = {
  n: number;
  date: LocalDate;
  interestCents: Cents;
  amortizationCents: Cents;
  insuranceCents: Cents;
  paymentCents: Cents;
  balanceCents: Cents;
};

export type FinancingResult = {
  system: AmortizationSystem;
  financedCents: Cents;
  iofCents: Cents;
  feesCents: Cents;
  installments: Installment[];
  firstPaymentCents: Cents;
  lastPaymentCents: Cents;
  totalPaidCents: Cents;
  totalInterestCents: Cents;
  totalInsuranceCents: Cents;
  /** Custo efetivo total, ao mês e ao ano (frações: 0.0189 = 1,89%). */
  cetMonthly: number | null;
  cetAnnual: number | null;
};

/** IOF de crédito PF: 0,38% fixo + 0,0082% ao dia (limitado a 365 dias) sobre cada amortização. */
export const IOF_PF = { fixed: 0.0038, daily: 0.000082, maxDays: 365 };

export function pricePayment(principal: number, rate: number, n: number): number {
  if (rate < 1e-9) return principal / n;
  return (principal * rate) / (1 - (1 + rate) ** -n);
}

function schedule(
  principal: Cents,
  rate: number,
  n: number,
  system: AmortizationSystem,
  dates: LocalDate[],
  insuranceRate: number,
): Installment[] {
  const out: Installment[] = [];
  let balance = principal;
  const pmt = pricePayment(principal, rate, n);
  for (let k = 1; k <= n; k++) {
    const interest = Math.round(balance * rate);
    let amort = system === 'price' ? Math.round(pmt) - interest : Math.round(principal / n);
    if (k === n) amort = balance; // a última parcela zera o saldo (absorve arredondamentos)
    const insurance = Math.round(balance * insuranceRate);
    balance -= amort;
    out.push({
      n: k,
      date: dates[k - 1]!,
      interestCents: interest,
      amortizationCents: amort,
      insuranceCents: insurance,
      paymentCents: interest + amort + insurance,
      balanceCents: balance,
    });
  }
  return out;
}

export function iofFor(rows: readonly Installment[], contract: LocalDate, financed: Cents): Cents {
  const daily = rows.reduce(
    (s, r) =>
      s +
      r.amortizationCents *
        IOF_PF.daily *
        Math.min(IOF_PF.maxDays, Math.max(0, diffDays(r.date, contract))),
    0,
  );
  return Math.round(financed * IOF_PF.fixed + daily);
}

export function simulateFinancing(input: FinancingInput): FinancingResult {
  const n = Math.max(1, Math.round(input.months));
  const rate = input.monthlyRatePct / 100;
  const insuranceRate = (input.insuranceMonthlyPct ?? 0) / 100;
  const fees = Math.max(0, input.feesCents ?? 0);
  const financeFees = input.financeFees ?? true;
  const first = input.firstDueDate ?? addMonths(input.contractDate, 1);
  const dates = Array.from({ length: n }, (_, i) => addMonths(first, i));

  const base = input.principalCents + (financeFees ? fees : 0);
  // IOF calculado sobre o cronograma sem IOF e financiado junto (como fazem os simuladores dos bancos)
  const iof =
    input.iof === false
      ? 0
      : iofFor(schedule(base, rate, n, input.system, dates, 0), input.contractDate, base);
  const financed = base + iof;
  const rows = schedule(financed, rate, n, input.system, dates, insuranceRate);

  // CET: o que o cliente recebe de fato contra tudo o que paga
  const received = input.principalCents - (financeFees ? 0 : fees);
  const cet = irr([received, ...rows.map((r) => -r.paymentCents)], rate || 0.01);
  const sum = (f: (r: Installment) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    system: input.system,
    financedCents: financed,
    iofCents: iof,
    feesCents: fees,
    installments: rows,
    firstPaymentCents: rows[0]!.paymentCents,
    lastPaymentCents: rows.at(-1)!.paymentCents,
    totalPaidCents: sum((r) => r.paymentCents) + (financeFees ? 0 : fees),
    totalInterestCents: sum((r) => r.interestCents),
    totalInsuranceCents: sum((r) => r.insuranceCents),
    cetMonthly: cet,
    cetAnnual: cet == null ? null : (1 + cet) ** 12 - 1,
  };
}
