import { z } from 'zod';
import type { LocalDate } from '../dates/local-date';

/**
 * Tabelas fiscais são DADO versionado (vigência), nunca constante espalhada no código.
 * Valores em centavos; alíquotas como fração (0,075 = 7,5%).
 * O servidor guarda cada tabela em `tax_table` e monta um `TaxTables` para a data de referência.
 */

const cents = z.number().int().nonnegative();
const rate = z.number().min(0).max(1);

/** Faixa progressiva: até `upTo` (inclusive; null = sem teto) aplica `rate` e abate `deduction`. */
const progressiveBracket = z.object({ upTo: cents.nullable(), rate, deduction: cents });

export const taxPayloadSchemas = {
  /** INSS do empregado: alíquota por faixa (cálculo progressivo, fatia a fatia). Último `upTo` = teto. */
  inss_employee: z.object({ brackets: z.array(z.object({ upTo: cents, rate })).min(1) }),
  /** IRRF mensal: tabela progressiva, dedução por dependente e desconto simplificado. */
  irrf_monthly: z.object({
    brackets: z.array(progressiveBracket).min(1),
    dependentDeduction: cents,
    simplifiedDiscount: cents,
  }),
  /**
   * Redução da Lei 15.270/2025 (mensal). Sobre os RENDIMENTOS TRIBUTÁVEIS (bruto), não sobre a base:
   * até `fullUpTo` → reduz até `fullMax` (zera o imposto); até `partialUpTo` → `a − b × rendimentos`.
   */
  irrf_reduction_monthly: z.object({
    fullUpTo: cents,
    fullMax: cents,
    partialUpTo: cents,
    a: cents,
    b: z.number().positive(),
  }),
  /** IRPF anual (ajuste): tabela, dependente e desconto simplificado (20% com teto). */
  irpf_annual: z.object({
    brackets: z.array(progressiveBracket).min(1),
    dependentDeduction: cents,
    simplifiedRate: rate,
    simplifiedCap: cents,
  }),
  /** Redução anual da Lei 15.270/2025 (mesma forma da mensal). */
  irpf_reduction_annual: z.object({
    fullUpTo: cents,
    fullMax: cents,
    partialUpTo: cents,
    a: cents,
    b: z.number().positive(),
  }),
  /** Simples Nacional: faixas por RBT12 com alíquota nominal e parcela a deduzir. */
  simples_annex_iii: z.object({ brackets: z.array(progressiveBracket).min(1) }),
  simples_annex_v: z.object({ brackets: z.array(progressiveBracket).min(1) }),
  /** Fator R: folha de 12 meses / RBT12 ≥ `threshold` → Anexo III; abaixo → Anexo V. */
  simples_fator_r: z.object({ threshold: rate }),
  /** DAS do MEI: 5% do salário mínimo + ISS e/ou ICMS fixos. */
  mei_das: z.object({ minimumWage: cents, inssRate: rate, iss: cents, icms: cents }),
  /** Lucro Presumido (serviços): percentuais efetivos sobre a receita + adicional do IRPJ. */
  presumido_services: z.object({
    irpj: rate,
    csll: rate,
    pis: rate,
    cofins: rate,
    presumedProfitRate: rate,
    irpjAdditionalRate: rate,
    irpjAdditionalMonthlyThreshold: cents,
  }),
  /** Contribuição do sócio sobre o pró-labore (contribuinte individual) e a patronal (fora do Simples). */
  pro_labore: z.object({ partnerRate: rate, employerRate: rate }),
  /** Lei 15.270: retenção sobre lucros/dividendos pagos a pessoa física acima do limite mensal por empresa. */
  dividends_withholding: z.object({ monthlyThreshold: cents, rate }),
} as const;

export type TaxKind = keyof typeof taxPayloadSchemas;
export const TAX_KINDS = Object.keys(taxPayloadSchemas) as TaxKind[];
export type TaxPayload<K extends TaxKind> = z.infer<(typeof taxPayloadSchemas)[K]>;

export type TaxTables = { [K in TaxKind]: TaxPayload<K> };

export type TaxTableRow = {
  kind: TaxKind;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  payload: unknown;
  sourceUrl: string;
  verifiedAt: LocalDate;
};

export function parseTaxPayload<K extends TaxKind>(kind: K, payload: unknown): TaxPayload<K> {
  return taxPayloadSchemas[kind].parse(payload) as TaxPayload<K>;
}

/**
 * Monta as tabelas vigentes em `date`: para cada tipo, a linha com a maior `validFrom` ≤ data
 * (e `validTo` nula ou ≥ data). Sem nenhuma vigente, usa a mais recente e avisa em `fallbacks`.
 */
export function resolveTaxTables(
  rows: readonly TaxTableRow[],
  date: LocalDate,
): { tables: TaxTables; fallbacks: TaxKind[] } {
  const out: Partial<Record<TaxKind, unknown>> = {};
  const fallbacks: TaxKind[] = [];
  for (const kind of TAX_KINDS) {
    const own = rows
      .filter((r) => r.kind === kind)
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
    const valid = own.find((r) => r.validFrom <= date && (r.validTo == null || r.validTo >= date));
    const chosen = valid ?? own[0];
    if (!chosen) throw new Error(`Tabela fiscal ausente: ${kind}`);
    if (!valid) fallbacks.push(kind);
    out[kind] = parseTaxPayload(kind, chosen.payload);
  }
  return { tables: out as TaxTables, fallbacks };
}

const RFB = 'https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026';
const LEI_15270 = 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15270.htm';
const INSS =
  'https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal';
const SIMPLES = 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm';
const VERIFIED = '2026-10-16' as LocalDate;
const FROM_2026 = '2026-01-01' as LocalDate;

/**
 * Tabelas de 2026 semeadas no banco (fontes secundárias conferidas em 16/10/2026; ⚠️ valide no DOU/RFB).
 * Quando sair a tabela nova, basta cadastrar outra linha com a nova vigência — nada no código muda.
 */
export const DEFAULT_TAX_TABLES: TaxTableRow[] = [
  {
    kind: 'inss_employee',
    validFrom: FROM_2026,
    validTo: null,
    sourceUrl: INSS,
    verifiedAt: VERIFIED,
    payload: {
      brackets: [
        { upTo: 162100, rate: 0.075 },
        { upTo: 290284, rate: 0.09 },
        { upTo: 435427, rate: 0.12 },
        { upTo: 847555, rate: 0.14 },
      ],
    },
  },
  {
    kind: 'irrf_monthly',
    validFrom: '2025-05-01' as LocalDate,
    validTo: null,
    sourceUrl: RFB,
    verifiedAt: VERIFIED,
    payload: {
      brackets: [
        { upTo: 242880, rate: 0, deduction: 0 },
        { upTo: 282665, rate: 0.075, deduction: 18216 },
        { upTo: 375105, rate: 0.15, deduction: 39416 },
        { upTo: 466468, rate: 0.225, deduction: 67549 },
        { upTo: null, rate: 0.275, deduction: 90873 },
      ],
      dependentDeduction: 18959,
      simplifiedDiscount: 60720,
    },
  },
  {
    kind: 'irrf_reduction_monthly',
    validFrom: FROM_2026,
    validTo: null,
    sourceUrl: LEI_15270,
    verifiedAt: VERIFIED,
    payload: { fullUpTo: 500000, fullMax: 31289, partialUpTo: 735000, a: 97862, b: 0.133145 },
  },
  {
    kind: 'irpf_annual',
    validFrom: FROM_2026,
    validTo: null,
    sourceUrl: RFB,
    verifiedAt: VERIFIED,
    payload: {
      // Tabela mensal × 12 (ano-calendário 2026). ⚠️ Há fontes com valores diferentes: confira.
      brackets: [
        { upTo: 2914560, rate: 0, deduction: 0 },
        { upTo: 3391980, rate: 0.075, deduction: 218592 },
        { upTo: 4501260, rate: 0.15, deduction: 472991 },
        { upTo: 5597616, rate: 0.225, deduction: 810585 },
        { upTo: null, rate: 0.275, deduction: 1090466 },
      ],
      dependentDeduction: 227508,
      simplifiedRate: 0.2,
      simplifiedCap: 1764000,
    },
  },
  {
    kind: 'irpf_reduction_annual',
    validFrom: FROM_2026,
    validTo: null,
    sourceUrl: LEI_15270,
    verifiedAt: VERIFIED,
    payload: { fullUpTo: 6000000, fullMax: 269415, partialUpTo: 8820000, a: 842973, b: 0.095575 },
  },
  {
    kind: 'simples_annex_iii',
    validFrom: '2018-01-01' as LocalDate,
    validTo: null,
    sourceUrl: SIMPLES,
    verifiedAt: VERIFIED,
    payload: {
      brackets: [
        { upTo: 18000000, rate: 0.06, deduction: 0 },
        { upTo: 36000000, rate: 0.112, deduction: 936000 },
        { upTo: 72000000, rate: 0.135, deduction: 1764000 },
        { upTo: 180000000, rate: 0.16, deduction: 3564000 },
        { upTo: 360000000, rate: 0.21, deduction: 12564000 },
        { upTo: 480000000, rate: 0.33, deduction: 64800000 },
      ],
    },
  },
  {
    kind: 'simples_annex_v',
    validFrom: '2018-01-01' as LocalDate,
    validTo: null,
    sourceUrl: SIMPLES,
    verifiedAt: VERIFIED,
    payload: {
      brackets: [
        { upTo: 18000000, rate: 0.155, deduction: 0 },
        { upTo: 36000000, rate: 0.18, deduction: 450000 },
        { upTo: 72000000, rate: 0.195, deduction: 990000 },
        { upTo: 180000000, rate: 0.205, deduction: 1710000 },
        { upTo: 360000000, rate: 0.23, deduction: 6210000 },
        { upTo: 480000000, rate: 0.305, deduction: 54000000 },
      ],
    },
  },
  {
    kind: 'simples_fator_r',
    validFrom: '2018-01-01' as LocalDate,
    validTo: null,
    sourceUrl: SIMPLES,
    verifiedAt: VERIFIED,
    payload: { threshold: 0.28 },
  },
  {
    kind: 'mei_das',
    validFrom: FROM_2026,
    validTo: null,
    sourceUrl: 'https://www.gov.br/empresas-e-negocios/pt-br/empreendedor',
    verifiedAt: VERIFIED,
    payload: { minimumWage: 162100, inssRate: 0.05, iss: 500, icms: 100 },
  },
  {
    kind: 'presumido_services',
    validFrom: '2015-01-01' as LocalDate,
    validTo: null,
    sourceUrl: 'https://www.planalto.gov.br/ccivil_03/leis/l9249.htm',
    verifiedAt: VERIFIED,
    payload: {
      irpj: 0.048,
      csll: 0.0288,
      pis: 0.0065,
      cofins: 0.03,
      presumedProfitRate: 0.32,
      irpjAdditionalRate: 0.1,
      irpjAdditionalMonthlyThreshold: 2000000,
    },
  },
  {
    kind: 'pro_labore',
    validFrom: '2015-01-01' as LocalDate,
    validTo: null,
    sourceUrl: INSS,
    verifiedAt: VERIFIED,
    payload: { partnerRate: 0.11, employerRate: 0.2 },
  },
  {
    kind: 'dividends_withholding',
    validFrom: FROM_2026,
    validTo: null,
    sourceUrl: LEI_15270,
    verifiedAt: VERIFIED,
    payload: { monthlyThreshold: 5000000, rate: 0.1 },
  },
];

/** Tabelas padrão já resolvidas (testes e fallback quando o banco ainda não foi semeado). */
export function defaultTaxTables(date: LocalDate = '2026-06-01' as LocalDate): TaxTables {
  return resolveTaxTables(DEFAULT_TAX_TABLES, date).tables;
}
