import { describe, expect, it } from 'vitest';
import { costMicrosUsd } from './pricing';
import { sanitizeForAi } from './sanitize';

describe('higienização para a IA', () => {
  it.each([
    ['PIX ENVIADO 123.456.789-09 JOAO', 'PIX ENVIADO [cpf] JOAO'],
    ['TED 12.345.678/0001-90 EMPRESA', 'TED [cnpj] EMPRESA'],
    ['PIX fulano@gmail.com', 'PIX [email]'],
    ['PIX (11) 98765-4321', 'PIX [telefone]'],
    ['TRANSF AG 1234 CONTA 56789-0', 'TRANSF [conta] [conta]'],
    ['COMPRA 1234567890 LOJA', 'COMPRA # LOJA'],
  ])('%s', (input, expected) => {
    expect(sanitizeForAi(input)).toBe(expected);
  });
});

describe('custo', () => {
  it('Haiku 5.5: 1M de entrada + 1M de saída = US$ 0,60', () => {
    expect(
      costMicrosUsd('claude-haiku-5-5', {
        inputTokens: 1e6,
        outputTokens: 1e6,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(600_000);
  });
  it('cache e lote', () => {
    expect(
      costMicrosUsd('claude-haiku-5-5', {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1e6,
        cacheWriteTokens: 1e6,
      }),
    ).toBe(135_000);
    expect(
      costMicrosUsd(
        'claude-haiku-5-5',
        { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        true,
      ),
    ).toBe(50_000);
  });
  it('modelo desconhecido custa 0 (e é registrado mesmo assim)', () => {
    expect(
      costMicrosUsd('x', {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0);
  });
});
