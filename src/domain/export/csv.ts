/**
 * CSV no formato que o Excel e o Google Planilhas em português abrem direto: separador ";",
 * decimal com vírgula e BOM UTF-8 (para acentos). Campos com ; " ou quebra de linha vão entre aspas.
 */
export function csvField(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Valor em centavos como número pt-BR sem separador de milhar (ex.: -1234,50). */
export function csvMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Data AAAA-MM-DD → DD/MM/AAAA. */
export function csvDate(d: string | null): string {
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvField).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
