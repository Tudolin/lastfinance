import type { Cents } from '../money';
import { inssCeiling, irrfMonthly, progressiveTax, type BreakdownLine } from './clt';
import type { TaxTables } from './tables';

const r = (x: number): Cents => Math.round(x + Number.EPSILON * Math.sign(x));

export type PjRegime = 'mei' | 'simples' | 'presumido' | 'manual';

export type PjConfig = {
  regime: PjRegime;
  /** MEI: serviços (ISS) ou comércio (ICMS). */
  meiActivity?: 'services' | 'commerce' | 'both';
  /** Simples: anexo fixo ou decidido pelo fator R. */
  simplesAnnex?: 'iii' | 'v' | 'fator_r';
  /** Receita bruta dos últimos 12 meses (RBT12). Sem ela, usa receita do mês × 12. */
  rbt12?: Cents | null;
  /** Folha dos últimos 12 meses (pró-labore + encargos) para o fator R. Sem ela, pró-labore × 12. */
  payroll12?: Cents | null;
  /** Alíquota do ISS (Presumido; no Simples o ISS já está no DAS). */
  issRate?: number;
  /** Regime manual: alíquota total sobre a receita. */
  manualRate?: number;
  /** Pró-labore mensal. */
  proLabore?: Cents;
  /** Custos mensais da empresa (contador, tarifas, sistemas). */
  monthlyCosts?: Cents;
  dependents?: number;
};

export type PjResult = {
  revenue: Cents;
  companyTaxes: Cents;
  /** Alíquota efetiva sobre a receita (impostos da empresa). */
  effectiveRate: number;
  annex: 'iii' | 'v' | null;
  fatorR: number | null;
  proLabore: Cents;
  proLaboreInss: Cents;
  proLaboreEmployerInss: Cents;
  proLaboreIrrf: Cents;
  costs: Cents;
  /** Lucro distribuído no mês (isento, salvo a retenção acima do limite). */
  distribution: Cents;
  dividendsWithholding: Cents;
  /** O que chega à pessoa física: pró-labore líquido + distribuição líquida. */
  net: Cents;
  lines: BreakdownLine[];
};

/** Alíquota efetiva do Simples: (RBT12 × nominal − parcela a deduzir) ÷ RBT12. */
export function simplesEffectiveRate(
  rbt12: Cents,
  brackets: readonly { upTo: Cents | null; rate: number; deduction: Cents }[],
): number {
  if (rbt12 <= 0) return brackets[0]!.rate;
  const tax = progressiveTax(rbt12, brackets);
  return tax / rbt12;
}

/**
 * Líquido mensal de PJ por regime. Simplificações (documentadas na tela):
 * - no Simples, o ISS e a CPP estão no DAS (anexos III e V);
 * - no Presumido, PIS/COFINS cumulativos e o adicional de IRPJ é mensal (o real é trimestral);
 * - o lucro distribuído é o que sobra depois de impostos, custos e pró-labore.
 */
export function pjNet(revenue: Cents, cfg: PjConfig, tables: TaxTables): PjResult {
  const costs = cfg.monthlyCosts ?? 0;
  const proLabore = cfg.regime === 'mei' ? 0 : (cfg.proLabore ?? 0);
  const lines: BreakdownLine[] = [{ label: 'Faturamento', cents: revenue }];
  let companyTaxes = 0;
  let annex: 'iii' | 'v' | null = null;
  let fatorR: number | null = null;
  let employerInss = 0;

  switch (cfg.regime) {
    case 'mei': {
      const m = tables.mei_das;
      const act = cfg.meiActivity ?? 'services';
      companyTaxes =
        r(m.minimumWage * m.inssRate) +
        (act === 'services' || act === 'both' ? m.iss : 0) +
        (act === 'commerce' || act === 'both' ? m.icms : 0);
      lines.push({ label: 'DAS do MEI', cents: -companyTaxes });
      break;
    }
    case 'simples': {
      const rbt12 = cfg.rbt12 ?? revenue * 12;
      const payroll12 = cfg.payroll12 ?? r(proLabore * 12 * (1 + tables.pro_labore.partnerRate));
      fatorR = rbt12 > 0 ? payroll12 / rbt12 : 0;
      annex =
        cfg.simplesAnnex === 'iii' || cfg.simplesAnnex === 'v'
          ? cfg.simplesAnnex
          : fatorR >= tables.simples_fator_r.threshold
            ? 'iii'
            : 'v';
      const rate = simplesEffectiveRate(
        rbt12,
        annex === 'iii' ? tables.simples_annex_iii.brackets : tables.simples_annex_v.brackets,
      );
      companyTaxes = r(revenue * rate);
      lines.push({
        label: `DAS (Simples, Anexo ${annex.toUpperCase()}, ${(rate * 100).toFixed(2).replace('.', ',')}%)`,
        cents: -companyTaxes,
      });
      break;
    }
    case 'presumido': {
      const p = tables.presumido_services;
      const iss = r(revenue * (cfg.issRate ?? 0.05));
      const federal = r(revenue * (p.irpj + p.csll + p.pis + p.cofins));
      const presumed = revenue * p.presumedProfitRate;
      const additional = r(
        Math.max(0, presumed - p.irpjAdditionalMonthlyThreshold) * p.irpjAdditionalRate,
      );
      employerInss = r(proLabore * tables.pro_labore.employerRate);
      companyTaxes = iss + federal + additional;
      lines.push({ label: 'IRPJ + CSLL + PIS + COFINS', cents: -federal });
      if (additional) lines.push({ label: 'Adicional de IRPJ', cents: -additional });
      lines.push({ label: 'ISS', cents: -iss });
      if (employerInss)
        lines.push({ label: 'INSS patronal (20% do pró-labore)', cents: -employerInss });
      break;
    }
    case 'manual': {
      companyTaxes = r(revenue * (cfg.manualRate ?? 0));
      lines.push({ label: 'Impostos (alíquota informada)', cents: -companyTaxes });
      break;
    }
  }
  if (costs) lines.push({ label: 'Custos da empresa', cents: -costs });

  // Pró-labore: INSS do sócio (11% até o teto) e IRRF pela tabela mensal.
  const proLaboreInss = r(
    Math.min(proLabore, inssCeiling(tables.inss_employee)) * tables.pro_labore.partnerRate,
  );
  const irrf = proLabore
    ? irrfMonthly({ taxable: proLabore, inss: proLaboreInss, dependents: cfg.dependents }, tables)
    : null;
  const proLaboreIrrf = irrf?.irrf ?? 0;
  if (proLabore) {
    lines.push({ label: 'INSS do sócio (11%)', cents: -proLaboreInss });
    if (proLaboreIrrf) lines.push({ label: 'IRRF do pró-labore', cents: -proLaboreIrrf });
  }

  const distribution = Math.max(0, revenue - companyTaxes - costs - proLabore - employerInss);
  const dw = tables.dividends_withholding;
  const dividendsWithholding = distribution > dw.monthlyThreshold ? r(distribution * dw.rate) : 0;
  if (dividendsWithholding)
    lines.push({ label: 'Retenção sobre dividendos (Lei 15.270)', cents: -dividendsWithholding });

  const net = distribution - dividendsWithholding + proLabore - proLaboreInss - proLaboreIrrf;
  return {
    revenue,
    companyTaxes,
    effectiveRate: revenue > 0 ? companyTaxes / revenue : 0,
    annex,
    fatorR,
    proLabore,
    proLaboreInss,
    proLaboreEmployerInss: employerInss,
    proLaboreIrrf,
    costs,
    distribution,
    dividendsWithholding,
    net,
    lines,
  };
}
