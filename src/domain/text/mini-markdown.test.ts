import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './mini-markdown';

describe('parseMarkdown', () => {
  it('lê títulos, parágrafos e listas', () => {
    const b = parseMarkdown(
      '## Resumo\nVocê gastou **R$ 100,00**\ncom delivery.\n\n- iFood\n- Rappi\n\n1. um\n2. dois',
    );
    expect(b).toEqual([
      { type: 'heading', content: [{ text: 'Resumo' }] },
      {
        type: 'paragraph',
        content: [
          { text: 'Você gastou ' },
          { text: 'R$ 100,00', bold: true },
          { text: ' com delivery.' },
        ],
      },
      { type: 'list', ordered: false, items: [[{ text: 'iFood' }], [{ text: 'Rappi' }]] },
      { type: 'list', ordered: true, items: [[{ text: 'um' }], [{ text: 'dois' }]] },
    ]);
  });

  it('lê tabelas', () => {
    const b = parseMarkdown('| Mês | Gasto |\n|---|---:|\n| set | R$ 1 |\n| out | R$ 2 |\n\nfim');
    expect(b[0]).toEqual({
      type: 'table',
      header: [[{ text: 'Mês' }], [{ text: 'Gasto' }]],
      rows: [
        [[{ text: 'set' }], [{ text: 'R$ 1' }]],
        [[{ text: 'out' }], [{ text: 'R$ 2' }]],
      ],
    });
    expect(b[1]).toEqual({ type: 'paragraph', content: [{ text: 'fim' }] });
  });

  it('trata texto incompleto durante o streaming sem quebrar', () => {
    expect(parseInline('**negrito sem fim')).toEqual([{ text: '**negrito sem fim' }]);
    expect(parseMarkdown('| a | b |')).toEqual([
      { type: 'paragraph', content: [{ text: '| a | b |' }] },
    ]);
  });
});
