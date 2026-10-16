import type { Cents } from '../money';
import type { TaxPayload, TaxTables } from './tables';

/** Arredonda para centavo inteiro (meio para cima), sem ruído de ponto flutuante. */
const r = (x: number): Cents => Math.round(x + Number.EPSILON * Math.sign(x));

// ───────────────────────── INSS ─────────────────────────

export function inssCeiling(t: TaxPayload<'inss_employee'>): Cents {
  return t.brackets[t.brackets.length - 1]!.upTo;
}

/** INSS progressivo, fatia a fatia, limitado ao teto. */
export function inssEmployee(gross: Cents, t: TaxPayload<'inss_employee'>): Cents {
  let prev = 0;
  let total = 0;
  for (const b of t.brackets) {
    if (gross <= prev) break;
    const slice = Math.min(gross, b.upTo) - prev;
    total += slice * b.rate;
    prev = b.upTo;
  }
  return r(total);
}

/** INSS máximo (salário ≥ teto). */
export function inssMax(t: TaxPayload<'inss_employee'>): Cents {
  return inssEmployee(inssCeiling(t), t);
}

/**
 * Vários vínculos: o INSS é calculado sobre a SOMA dos salários (limitada ao teto) e
 * rateado proporcionalmente entre os empregadores (o trabalhador informa a cada um).
 */
export function allocateInss(grosses: readonly Cents[], t: TaxPayload<'inss_employee'>): Cents[] {
  const total = grosses.reduce((a, b) => a + b, 0);
  if (total <= 0) return grosses.map(() => 0);
  const inss = inssEmployee(total, t);
  const shares = grosses.map((g) => Math.floor((inss * g) / total));
  // distribui o resto dos centavos para os maiores salários
  let rest = inss - shares.reduce((a, b) => a + b, 0);
  const order = grosses.map((g, i) => [g, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) shares[order[k]![1]]! += 1;
  return shares;
}

// ───────────────────────── IRRF ─────────────────────────

type Bracket = { upTo: Cents | null; rate: number; deduction: Cents };

/** Imposto pela tabela progressiva (alíquota da faixa × base − parcela a deduzir). */
export function progressiveTax(base: Cents, brackets: readonly Bracket[]): Cents {
  if (base <= 0) return 0;
  const b =
    brackets.find((x) => x.upTo == null || base <= x.upTo) ?? brackets[brackets.length - 1]!;
  return Math.max(0, r(base * b.rate - b.deduction));
}

type Reduction = { fullUpTo: Cents; fullMax: Cents; partialUpTo: Cents; a: Cents; b: number };

/**
 * Redução da Lei 15.270/2025, calculada sobre os rendimentos tributáveis (bruto) e limitada ao
 * imposto apurado (nunca gera imposto negativo).
 */
export function lei15270Reduction(taxableIncome: Cents, tax: Cents, red: Reduction): Cents {
  if (tax <= 0) return 0;
  let reduction = 0;
  if (taxableIncome <= red.fullUpTo) reduction = red.fullMax;
  else if (taxableIncome <= red.partialUpTo)
    reduction = Math.max(0, r(red.a - red.b * taxableIncome));
  return Math.min(tax, reduction);
}

export type IrrfInput = {
  /** Rendimentos tributáveis do mês (bruto). */
  taxable: Cents;
  /** INSS (oficial) retido no mês. */
  inss: Cents;
  dependents?: number;
  /** Pensão alimentícia judicial. */
  alimony?: Cents;
  /** Previdência complementar dedutível (PGBL/Funpresp) descontada em folha. */
  privatePension?: Cents;
};

export type IrrfResult = {
  mode: 'legal' | 'simplified';
  base: Cents;
  taxBeforeReduction: Cents;
  reduction: Cents;
  irrf: Cents;
  legal: { base: Cents; tax: Cents };
  simplified: { base: Cents; tax: Cents };
};

/**
 * IRRF mensal: compara deduções legais × desconto simplificado (vale o que der MENOS imposto)
 * e aplica a redução da Lei 15.270 sobre o bruto tributável.
 */
export function irrfMonthly(
  input: IrrfInput,
  tables: Pick<TaxTables, 'irrf_monthly' | 'irrf_reduction_monthly'>,
): IrrfResult {
  const t = tables.irrf_monthly;
  const legalDeductions =
    input.inss +
    (input.dependents ?? 0) * t.dependentDeduction +
    (input.alimony ?? 0) +
    (input.privatePension ?? 0);
  const legalBase = Math.max(0, input.taxable - legalDeductions);
  const simplifiedBase = Math.max(0, input.taxable - t.simplifiedDiscount);
  const legalTax = progressiveTax(legalBase, t.brackets);
  const simplifiedTax = progressiveTax(simplifiedBase, t.brackets);
  const mode = simplifiedTax < legalTax ? 'simplified' : 'legal';
  const base = mode === 'legal' ? legalBase : simplifiedBase;
  const tax = Math.min(legalTax, simplifiedTax);
  const reduction = lei15270Reduction(input.taxable, tax, tables.irrf_reduction_monthly);
  return {
    mode,
    base,
    taxBeforeReduction: tax,
    reduction,
    irrf: tax - reduction,
    legal: { base: legalBase, tax: legalTax },
    simplified: { base: simplifiedBase, tax: simplifiedTax },
  };
}

// ───────────────────────── Salário líquido CLT ─────────────────────────

/** Descontos pós-imposto (não reduzem a base do IR). */
export type CltDeductions = {
  dependents?: number;
  alimony?: Cents;
  privatePension?: Cents;
  /** Vale-transporte: desconto de 6% do salário, limitado ao valor do benefício. */
  transportVoucher?: Cents | null;
  /** Vale-refeição/alimentação, plano de saúde, sindicato e outros, em centavos. */
  others?: { label: string; cents: Cents }[];
};

export type CltInput = CltDeductions & {
  gross: Cents;
  /** Outros proventos tributáveis do mês (horas extras, bônus). */
  extraTaxable?: Cents;
  /** INSS já rateado (vários vínculos). Se ausente, calcula sobre o próprio bruto. */
  inssOverride?: Cents;
};

export type BreakdownLine = { label: string; cents: Cents };

export type CltResult = {
  gross: Cents;
  inss: Cents;
  irrf: IrrfResult;
  transportVoucher: Cents;
  otherDeductions: Cents;
  net: Cents;
  lines: BreakdownLine[];
};

export function cltNet(input: CltInput, tables: TaxTables): CltResult {
  const taxable = input.gross + (input.extraTaxable ?? 0);
  const inss = input.inssOverride ?? inssEmployee(taxable, tables.inss_employee);
  const irrf = irrfMonthly(
    {
      taxable,
      inss,
      dependents: input.dependents,
      alimony: input.alimony,
      privatePension: input.privatePension,
    },
    tables,
  );
  const vt =
    input.transportVoucher != null ? Math.min(r(input.gross * 0.06), input.transportVoucher) : 0;
  const others = (input.others ?? []).reduce((s, o) => s + o.cents, 0);
  const alimony = input.alimony ?? 0;
  const pension = input.privatePension ?? 0;
  const net = taxable - inss - irrf.irrf - vt - others - alimony - pension;
  const lines: BreakdownLine[] = [
    { label: 'Salário bruto', cents: input.gross },
    ...(input.extraTaxable ? [{ label: 'Outros proventos', cents: input.extraTaxable }] : []),
    { label: 'INSS', cents: -inss },
    {
      label: `IRRF (${irrf.mode === 'legal' ? 'deduções legais' : 'desconto simplificado'})`,
      cents: -irrf.taxBeforeReduction,
    },
    ...(irrf.reduction ? [{ label: 'Redução Lei 15.270', cents: irrf.reduction }] : []),
    ...(alimony ? [{ label: 'Pensão alimentícia', cents: -alimony }] : []),
    ...(pension ? [{ label: 'Previdência complementar', cents: -pension }] : []),
    ...(vt ? [{ label: 'Vale-transporte (6%)', cents: -vt }] : []),
    ...(input.others ?? []).map((o) => ({ label: o.label, cents: -o.cents })),
  ];
  return { gross: taxable, inss, irrf, transportVoucher: vt, otherDeductions: others, net, lines };
}

// ───────────────────────── 13º e férias ─────────────────────────

/** 1ª parcela do 13º (até 30/11): metade do bruto, sem descontos. */
export function thirteenthFirst(gross: Cents, monthsWorked = 12): Cents {
  return r((gross * monthsWorked) / 12 / 2);
}

/**
 * 2ª parcela do 13º (até 20/12): bruto − INSS − IRRF (tributação exclusiva, com a redução da
 * Lei 15.270) − 1ª parcela.
 */
export function thirteenthSecond(
  gross: Cents,
  tables: TaxTables,
  opts: { monthsWorked?: number; dependents?: number; alimony?: Cents } = {},
): {
  gross: Cents;
  inss: Cents;
  irrf: IrrfResult;
  firstInstallment: Cents;
  net: Cents;
  lines: BreakdownLine[];
} {
  const g = r((gross * (opts.monthsWorked ?? 12)) / 12);
  const inss = inssEmployee(g, tables.inss_employee);
  const irrf = irrfMonthly(
    { taxable: g, inss, dependents: opts.dependents, alimony: opts.alimony },
    tables,
  );
  const first = thirteenthFirst(gross, opts.monthsWorked);
  const net = g - inss - irrf.irrf - first;
  return {
    gross: g,
    inss,
    irrf,
    firstInstallment: first,
    net,
    lines: [
      { label: '13º bruto', cents: g },
      { label: 'INSS sobre o 13º', cents: -inss },
      { label: 'IRRF sobre o 13º', cents: -irrf.taxBeforeReduction },
      ...(irrf.reduction ? [{ label: 'Redução Lei 15.270', cents: irrf.reduction }] : []),
      { label: '1ª parcela já paga', cents: -first },
    ],
  };
}

/**
 * Férias: (salário ÷ 30 × dias) + 1/3, com INSS e IRRF calculados sobre o valor das férias
 * (aproximação: na folha real o INSS do mês soma férias e salário).
 */
export function vacationPay(
  gross: Cents,
  days: number,
  tables: TaxTables,
  opts: { dependents?: number } = {},
): { gross: Cents; inss: Cents; irrf: IrrfResult; net: Cents; lines: BreakdownLine[] } {
  const base = r((gross / 30) * days);
  const third = r(base / 3);
  const g = base + third;
  const inss = inssEmployee(g, tables.inss_employee);
  const irrf = irrfMonthly({ taxable: g, inss, dependents: opts.dependents }, tables);
  return {
    gross: g,
    inss,
    irrf,
    net: g - inss - irrf.irrf,
    lines: [
      { label: `Férias (${days} dias)`, cents: base },
      { label: '1/3 constitucional', cents: third },
      { label: 'INSS', cents: -inss },
      { label: 'IRRF', cents: -irrf.taxBeforeReduction },
      ...(irrf.reduction ? [{ label: 'Redução Lei 15.270', cents: irrf.reduction }] : []),
    ],
  };
}

/** Proporcional do 1º mês (mês comercial de 30 dias): dias trabalhados a partir de `startDay`. */
export function prorateFirstMonth(gross: Cents, startDay: number, daysInMonth: number): Cents {
  if (startDay <= 1) return gross;
  const worked = Math.max(0, Math.min(30, daysInMonth - startDay + 1));
  return r((gross / 30) * worked);
}

// ───────────────────────── Ajuste anual ─────────────────────────

export type AnnualInput = {
  /** Rendimentos tributáveis no ajuste (salários, férias; o 13º e a PLR ficam de fora: são exclusivos). */
  taxable: Cents;
  /** INSS oficial pago no ano (sobre esses rendimentos). */
  inss: Cents;
  /** IRRF retido no ano sobre esses rendimentos. */
  withheld: Cents;
  dependents?: number;
  alimony?: Cents;
  privatePension?: Cents;
  /** Outras deduções da declaração completa (saúde, educação limitada etc.). */
  otherDeductions?: Cents;
};

export type AnnualResult = {
  mode: 'complete' | 'simplified';
  base: Cents;
  taxBeforeReduction: Cents;
  reduction: Cents;
  tax: Cents;
  withheld: Cents;
  /** > 0: a pagar na declaração; < 0: a restituir. */
  balance: Cents;
  /** Provisão mensal sugerida (só quando há imposto a pagar). */
  monthlyProvision: Cents;
};

/**
 * Estimativa do ajuste anual. Importa sobretudo com mais de um vínculo: cada folha aplica a faixa
 * isenta e a redução sozinha, e a soma pode gerar imposto a pagar na declaração.
 */
export function annualAdjustment(input: AnnualInput, tables: TaxTables): AnnualResult {
  const t = tables.irpf_annual;
  const complete =
    input.inss +
    (input.dependents ?? 0) * t.dependentDeduction +
    (input.alimony ?? 0) +
    (input.privatePension ?? 0) +
    (input.otherDeductions ?? 0);
  const simplifiedDiscount = Math.min(r(input.taxable * t.simplifiedRate), t.simplifiedCap);
  const completeBase = Math.max(0, input.taxable - complete);
  const simplifiedBase = Math.max(0, input.taxable - simplifiedDiscount);
  const completeTax = progressiveTax(completeBase, t.brackets);
  const simplifiedTax = progressiveTax(simplifiedBase, t.brackets);
  const mode = simplifiedTax < completeTax ? 'simplified' : 'complete';
  const taxBefore = Math.min(completeTax, simplifiedTax);
  const reduction = lei15270Reduction(input.taxable, taxBefore, tables.irpf_reduction_annual);
  const tax = taxBefore - reduction;
  const balance = tax - input.withheld;
  return {
    mode,
    base: mode === 'complete' ? completeBase : simplifiedBase,
    taxBeforeReduction: taxBefore,
    reduction,
    tax,
    withheld: input.withheld,
    balance,
    monthlyProvision: balance > 0 ? Math.ceil(balance / 12) : 0,
  };
}

/**
 * Vários vínculos CLT no mesmo mês: INSS rateado sobre a soma (teto único), IRRF de cada folha
 * calculado sozinho, e a estimativa do ajuste anual (12 meses iguais).
 */
export function multipleEmployments(
  jobs: readonly (CltDeductions & { gross: Cents })[],
  tables: TaxTables,
): { perJob: CltResult[]; annual: AnnualResult; totalNet: Cents } {
  const inss = allocateInss(
    jobs.map((j) => j.gross),
    tables.inss_employee,
  );
  const perJob = jobs.map((j, i) => cltNet({ ...j, inssOverride: inss[i] }, tables));
  const dependents = Math.max(0, ...jobs.map((j) => j.dependents ?? 0));
  const annual = annualAdjustment(
    {
      taxable: perJob.reduce((s, p) => s + p.gross, 0) * 12,
      inss: perJob.reduce((s, p) => s + p.inss, 0) * 12,
      withheld: perJob.reduce((s, p) => s + p.irrf.irrf, 0) * 12,
      dependents,
      alimony: jobs.reduce((s, j) => s + (j.alimony ?? 0), 0) * 12,
      privatePension: jobs.reduce((s, j) => s + (j.privatePension ?? 0), 0) * 12,
    },
    tables,
  );
  return { perJob, annual, totalNet: perJob.reduce((s, p) => s + p.net, 0) };
}
