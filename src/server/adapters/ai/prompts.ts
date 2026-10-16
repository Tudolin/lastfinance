import type { CategorizeContext, CategorizeItem } from './types';

/**
 * Prompt de sistema da categorização. Fica estável entre chamadas (lista de categorias e exemplos só
 * mudam quando o usuário edita), então é cacheado. Nada de data/hora aqui.
 */
export function categorizeSystemPrompt(ctx: CategorizeContext): string {
  const cats = ctx.categories
    .map(
      (c) =>
        `- ${c.slug}: ${c.parent ? `${c.parent} › ` : ''}${c.name} (${c.kind === 'income' ? 'receita' : 'despesa'})`,
    )
    .join('\n');
  const examples = ctx.examples.length
    ? ctx.examples.map((e) => `- "${e.description}" → ${e.slug}`).join('\n')
    : '- (ainda sem correções do usuário)';
  return `Você categoriza estabelecimentos de extratos bancários e faturas de cartão de uma pessoa no Brasil.

Para cada item recebido (descrição normalizada de um estabelecimento, direção do dinheiro, valor típico em reais, número de ocorrências e se foi no cartão ou na conta), devolva:
- merchant_name: nome legível do estabelecimento (ex.: "IFD*IFOOD" → "iFood"); sem inventar detalhes.
- category: exatamente um dos slugs da lista abaixo. Use a categoria mais específica que se aplique. Entradas de dinheiro ("in") usam categorias de receita; saídas ("out"), de despesa.
- nature: "fixed" (mesmo valor todo mês: aluguel, assinatura, mensalidade), "variable_recurring" (todo mês, valor oscila: mercado, combustível, delivery, luz) ou "eventual" (pontual).
- looks_recurring e periodicity (weekly, monthly, yearly, irregular).
- confidence: de 0 a 1. Use abaixo de 0.7 quando a descrição for ambígua (ex.: Pix para pessoa física, nomes genéricos) — o usuário vai revisar.
- new_category_suggestion: só quando nenhuma categoria servir bem; caso contrário null. Mesmo sugerindo, escolha a melhor categoria existente em "category".

Não invente valores nem faça contas. Responda apenas no formato pedido.

Categorias (slug: nome):
${cats}

Correções feitas pelo usuário (siga este padrão):
${examples}`;
}

export function categorizeUserMessage(items: CategorizeItem[]): string {
  return JSON.stringify(items);
}
