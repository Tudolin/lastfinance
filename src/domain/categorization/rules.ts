import { z } from 'zod';
import { TX_KINDS, type TxKind } from '../classification/types';
import { foldText } from '../text/normalize';

/** Regras do usuário ("se a descrição contém UBER → Transporte"). Validadas por Zod ao gravar. */
export const ruleConditionsSchema = z
  .object({
    /** Qualquer um dos termos (sem acento, sem caixa). */
    descriptionContains: z.array(z.string().trim().min(2).max(80)).max(20).optional(),
    /** Expressão regular sobre a descrição sem acentos em maiúsculas. */
    descriptionRegex: z.string().max(200).optional(),
    accountIds: z.array(z.string().uuid()).max(20).optional(),
    direction: z.enum(['in', 'out']).optional(),
    minCents: z.number().int().nonnegative().optional(),
    maxCents: z.number().int().nonnegative().optional(),
  })
  .refine((c) => !!(c.descriptionContains?.length || c.descriptionRegex || c.accountIds?.length), {
    message: 'A regra precisa de pelo menos uma condição de descrição ou conta.',
  })
  .refine((c) => {
    if (!c.descriptionRegex) return true;
    try {
      new RegExp(c.descriptionRegex);
      return true;
    } catch {
      return false;
    }
  }, 'Expressão regular inválida.');
export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

export const ruleActionsSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    kind: z.enum(TX_KINDS).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    rename: z.string().trim().min(1).max(120).optional(),
  })
  .refine((a) => !!(a.categoryId || a.kind || a.tags?.length || a.rename), {
    message: 'A regra precisa de pelo menos uma ação.',
  });
export type RuleActions = z.infer<typeof ruleActionsSchema>;

export type Rule = {
  id: string;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
};
export type RuleSubject = { description: string; accountId: string; amountCents: number };

const regexCache = new Map<string, RegExp | null>();
function compile(src: string): RegExp | null {
  if (!regexCache.has(src)) {
    try {
      regexCache.set(src, new RegExp(src, 'i'));
    } catch {
      regexCache.set(src, null);
    }
  }
  return regexCache.get(src)!;
}

export function matchesRule(c: RuleConditions, t: RuleSubject): boolean {
  const desc = foldText(t.description);
  if (
    c.descriptionContains?.length &&
    !c.descriptionContains.some((term) => desc.includes(foldText(term)))
  )
    return false;
  if (c.descriptionRegex) {
    const re = compile(c.descriptionRegex);
    if (!re || !re.test(desc.slice(0, 500))) return false;
  }
  if (c.accountIds?.length && !c.accountIds.includes(t.accountId)) return false;
  if (c.direction === 'in' && t.amountCents <= 0) return false;
  if (c.direction === 'out' && t.amountCents >= 0) return false;
  const abs = Math.abs(t.amountCents);
  if (c.minCents != null && abs < c.minCents) return false;
  if (c.maxCents != null && abs > c.maxCents) return false;
  return true;
}

/** Primeira regra ativa que casa, por prioridade (menor = antes) e depois id — determinístico. */
export function firstMatchingRule(rules: readonly Rule[], t: RuleSubject): Rule | null {
  const sorted = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
  return sorted.find((r) => matchesRule(r.conditions, t)) ?? null;
}

/**
 * Regra sugerida a partir de uma correção manual: usa o "núcleo" da descrição normalizada
 * (as duas primeiras palavras significativas), para pegar a mesma loja no futuro.
 */
export function ruleFromCorrection(
  descriptionNorm: string,
  action: { categoryId?: string; kind?: TxKind },
): { conditions: RuleConditions; actions: RuleActions } | null {
  const words = descriptionNorm.split(' ').filter(Boolean);
  const significant = (w: string) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w);
  const start = words.findIndex(significant);
  if (start < 0) return null;
  // Trecho contíguo (até 2 palavras) para casar com "contém" na descrição original.
  const next = words[start + 1];
  const term = next && !/^\d+$/.test(next) ? `${words[start]} ${next}` : words[start]!;
  return { conditions: { descriptionContains: [term] }, actions: action };
}

const STOP = new Set([
  'PIX',
  'TED',
  'DOC',
  'COMPRA',
  'PAGAMENTO',
  'PAG',
  'DEBITO',
  'CREDITO',
  'CARTAO',
  'ENVIADO',
  'RECEBIDO',
  'TRANSF',
  'TRANSFERENCIA',
  'LTDA',
  'SAO',
  'PAULO',
  'BRASIL',
  'COM',
  'BR',
]);
