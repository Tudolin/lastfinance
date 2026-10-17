import { describe, expect, it } from 'vitest';
import { csvDate, csvField, csvMoney, toCsv } from './csv';

describe('csv', () => {
  it('escapa separador, aspas e quebras de linha', () => {
    expect(csvField('IFOOD *RESTAURANTE')).toBe('IFOOD *RESTAURANTE');
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvField('linha\nnova')).toBe('"linha\nnova"');
    expect(csvField(null)).toBe('');
  });

  it('formata dinheiro e data no padrão brasileiro', () => {
    expect(csvMoney(-123450)).toBe('-1234,50');
    expect(csvMoney(5)).toBe('0,05');
    expect(csvMoney(0)).toBe('0,00');
    expect(csvDate('2026-10-07')).toBe('07/10/2026');
  });

  it('monta o arquivo com BOM e CRLF', () => {
    const s = toCsv(['Data', 'Valor'], [['07/10/2026', '-10,00']]);
    expect(s.startsWith('﻿Data;Valor\r\n')).toBe(true);
    expect(s.endsWith('07/10/2026;-10,00\r\n')).toBe(true);
  });
});
