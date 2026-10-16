import type { LocalDate } from '../dates/local-date';
import type { Cents } from '../money';

export type ForecastSourceType = 'income' | 'recurring' | 'planned' | 'installment';
export type ForecastStatus = 'previsto' | 'realizado' | 'atrasado' | 'cancelado' | 'ajustado';
export type Direction = 'in' | 'out';

/**
 * Uma ocorrência planejada (gerada por regra). `expectedDate` é quando a transação deve aparecer
 * (na conta ou no cartão); `cashDate` é quando o dinheiro sai/entra da conta (no cartão, o vencimento).
 */
export type ForecastDraft = {
  sourceType: ForecastSourceType;
  sourceId: string;
  direction: Direction;
  accountId: string | null;
  categoryId: string | null;
  label: string;
  expectedDate: LocalDate;
  cashDate: LocalDate;
  windowStart: LocalDate;
  windowEnd: LocalDate;
  /** Sempre positivo; o sentido vem de `direction`. */
  expectedCents: Cents;
  lowCents: Cents;
  highCents: Cents;
  certainty: 'certain' | 'estimated';
  /** Tolerância de valor para a conciliação (fração: 0,1 = 10%). */
  tolerancePct: number;
  /** Texto que ajuda a reconhecer a transação (empregador, estabelecimento). */
  matchPattern: string | null;
  breakdown: unknown;
};

export const SOURCE_LABEL: Record<ForecastSourceType, string> = {
  income: 'Renda',
  recurring: 'Recorrente',
  planned: 'Planejado',
  installment: 'Parcela',
};
