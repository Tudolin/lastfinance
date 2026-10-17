import type { Cents } from '../money';

/**
 * Renda fixa pós-fixada (CDB/RDB/caixinha a X% do CDI): IR regressivo por prazo de cada aporte e
 * comparação com a poupança. Funções puras; taxas como frações (0.1415 = 14,15% ao ano).
 */

/** Alíquota de IR sobre o rendimento pelo número de dias corridos aplicado. */
export function irRate(days: number): number {
  if (days <= 180) return 0.225;
  if (days <= 360) return 0.2;
  if (days <= 720) return 0.175;
  return 0.15;
}

/** IOF regressivo sobre o rendimento nos 30 primeiros dias (fração do rendimento). */
export function iofRate(days: number): number {
  if (days >= 30) return 0;
  const table = [
    96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23, 20,
    16, 13, 10, 6, 3, 0,
  ];
  return (table[Math.max(0, days - 1)] ?? 0) / 100;
}

/** CDI anual a partir da taxa diária do BCB (% ao dia, 252 dias úteis). */
export function annualFromDaily(dailyPct: number): number {
  return (1 + dailyPct / 100) ** 252 - 1;
}

/** Taxa mensal equivalente a uma taxa anual. */
export function monthlyFromAnnual(annual: number): number {
  return (1 + annual) ** (1 / 12) - 1;
}

/** Poupança: 0,5% a.m. (+TR) com Selic acima de 8,5% a.a.; senão 70% da Selic. TR tratada como zero. */
export function savingsAccountAnnual(selicAnnual: number): number {
  return selicAnnual > 0.085 ? 1.005 ** 12 - 1 : selicAnnual * 0.7;
}

export type GrowthInput = {
  initialCents: Cents;
  monthlyCents: Cents;
  months: number;
  /** CDI anual (fração). */
  cdiAnnual: number;
  /** % do CDI (100 = 100%). */
  cdiPct: number;
};

export type GrowthPoint = {
  month: number;
  investedCents: Cents;
  grossCents: Cents;
  irCents: Cents;
  netCents: Cents;
};

/**
 * Evolução mês a mês. Cada aporte é um lote com o próprio prazo de IR (como no resgate real, que
 * consome os lotes mais antigos primeiro). O líquido é o valor se tudo fosse resgatado naquele mês.
 */
export function projectGrowth(g: GrowthInput): GrowthPoint[] {
  const m = monthlyFromAnnual(g.cdiAnnual * (g.cdiPct / 100));
  const lots: { principal: number; value: number; age: number }[] = [];
  if (g.initialCents > 0) lots.push({ principal: g.initialCents, value: g.initialCents, age: 0 });
  const out: GrowthPoint[] = [];
  for (let k = 1; k <= g.months; k++) {
    for (const l of lots) {
      l.value *= 1 + m;
      l.age++;
    }
    if (g.monthlyCents > 0) lots.push({ principal: g.monthlyCents, value: g.monthlyCents, age: 0 });
    let invested = 0;
    let gross = 0;
    let ir = 0;
    for (const l of lots) {
      invested += l.principal;
      gross += l.value;
      ir += Math.max(0, l.value - l.principal) * irRate(l.age * 30);
    }
    out.push({
      month: k,
      investedCents: Math.round(invested),
      grossCents: Math.round(gross),
      irCents: Math.round(ir),
      netCents: Math.round(gross - ir),
    });
  }
  return out;
}

/** Valor final sem imposto a uma taxa anual (poupança, ou 0 = dinheiro parado). */
export function projectTaxFree(
  initialCents: Cents,
  monthlyCents: Cents,
  months: number,
  annual: number,
): Cents {
  const m = monthlyFromAnnual(annual);
  let v = initialCents;
  for (let k = 1; k <= months; k++) v = v * (1 + m) + monthlyCents;
  return Math.round(v);
}

/** Aporte mensal necessário para chegar a `targetCents` líquidos em `months` (busca binária). */
export function requiredMonthly(targetCents: Cents, g: Omit<GrowthInput, 'monthlyCents'>): Cents {
  if (g.months <= 0) return Math.max(0, targetCents - g.initialCents);
  const net = (mc: number) =>
    projectGrowth({ ...g, monthlyCents: mc }).at(-1)?.netCents ?? g.initialCents;
  if (net(0) >= targetCents) return 0;
  let lo = 0;
  let hi = Math.max(1, targetCents);
  for (let i = 0; i < 60 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (net(mid) >= targetCents) hi = mid;
    else lo = mid;
  }
  return hi;
}
