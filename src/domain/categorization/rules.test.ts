import { describe, expect, it } from 'vitest';
import {
  firstMatchingRule,
  matchesRule,
  ruleConditionsSchema,
  ruleFromCorrection,
  type Rule,
} from './rules';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const t = (description: string, amountCents = -1000, accountId = A) => ({
  description,
  amountCents,
  accountId,
});

describe('regras', () => {
  it('casa por termo, sem acento e sem caixa', () => {
    expect(matchesRule({ descriptionContains: ['uber'] }, t('UBER *TRIP'))).toBe(true);
    expect(matchesRule({ descriptionContains: ['açaí'] }, t('ACAI DO ZE'))).toBe(true);
    expect(matchesRule({ descriptionContains: ['uber'] }, t('99 POP'))).toBe(false);
  });

  it('combina conta, direção e faixa de valor', () => {
    const c = {
      descriptionContains: ['pix'],
      accountIds: [A],
      direction: 'out' as const,
      minCents: 500,
      maxCents: 2000,
    };
    expect(matchesRule(c, t('PIX ENVIADO', -1000))).toBe(true);
    expect(matchesRule(c, t('PIX ENVIADO', 1000))).toBe(false);
    expect(matchesRule(c, t('PIX ENVIADO', -3000))).toBe(false);
    expect(matchesRule(c, t('PIX ENVIADO', -1000, B))).toBe(false);
  });

  it('regex inválida é rejeitada na validação', () => {
    expect(ruleConditionsSchema.safeParse({ descriptionRegex: '(' }).success).toBe(false);
    expect(ruleConditionsSchema.safeParse({}).success).toBe(false);
    expect(ruleConditionsSchema.safeParse({ descriptionRegex: '^IFD\\*' }).success).toBe(true);
  });

  it('prioridade decide entre regras que casam; desativadas não contam', () => {
    const rules: Rule[] = [
      {
        id: 'b',
        priority: 10,
        enabled: true,
        conditions: { descriptionContains: ['uber'] },
        actions: { tags: ['geral'] },
      },
      {
        id: 'a',
        priority: 1,
        enabled: true,
        conditions: { descriptionContains: ['uber eats'] },
        actions: { tags: ['delivery'] },
      },
      {
        id: 'c',
        priority: 0,
        enabled: false,
        conditions: { descriptionContains: ['uber'] },
        actions: { tags: ['off'] },
      },
    ];
    expect(firstMatchingRule(rules, t('UBER EATS PEDIDO'))?.id).toBe('a');
    expect(firstMatchingRule(rules, t('UBER TRIP'))?.id).toBe('b');
    expect(firstMatchingRule(rules, t('NETFLIX'))).toBeNull();
  });

  it('correção vira regra pelo núcleo da descrição', () => {
    const r = ruleFromCorrection('PIX ENVIADO PADARIA SAO JORGE', { kind: 'expense' })!;
    expect(r.conditions).toEqual({ descriptionContains: ['PADARIA SAO'] });
    expect(matchesRule(r.conditions, t('PIX ENVIADO PADARIA SAO JORGE 12/10'))).toBe(true);
    expect(
      ruleFromCorrection('IFOOD CLUB', { kind: 'expense' })?.conditions.descriptionContains,
    ).toEqual(['IFOOD CLUB']);
    expect(ruleFromCorrection('PIX 123', { kind: 'expense' })).toBeNull();
  });
});
