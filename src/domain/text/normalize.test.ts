import { describe, expect, it } from 'vitest';
import { foldText, normalizeDescription, tokenSimilarity } from './normalize';

describe('normalizeDescription', () => {
  it.each([
    ['Uber *Trip 12/03 São Paulo', 'UBER TRIP SAO PAULO'],
    ['PG *NETSHOES 03/10', 'NETSHOES'],
    ['IFD*IFOOD CLUB', 'IFOOD CLUB'],
    ['NETFLIX.COM', 'NETFLIX COM'],
    ['Pix enviado 12345678 João', 'PIX ENVIADO JOAO'],
    ['NOTEBOOK DELL PARC 03/10', 'NOTEBOOK DELL'],
    ['Padaria 08:31', 'PADARIA'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeDescription(raw)).toBe(expected);
  });

  it('remove acentos e normaliza espaços', () => {
    expect(foldText('  Pão   de Açúcar ')).toBe('PAO DE ACUCAR');
  });
});

describe('tokenSimilarity', () => {
  it('é 1 para descrições equivalentes e 0 para disjuntas', () => {
    expect(tokenSimilarity('Amazon Marketplace', 'AMAZON  marketplace 1/3')).toBe(1);
    expect(tokenSimilarity('Uber', 'Netflix')).toBe(0);
  });
});
