/**
 * Dinheiro é sempre representado em centavos inteiros (`Cents`).
 * Valores vindos de APIs (reais em ponto flutuante) entram por `toCents`.
 */
export type Cents = number;

export function toCents(reais: number): Cents {
  if (!Number.isFinite(reais)) throw new RangeError(`Valor inválido: ${reais}`);
  // toFixed(2) elimina o ruído binário (ex.: 0.1 + 0.2) antes de escalar.
  const cents = Math.round(Number(reais.toFixed(2)) * 100);
  return cents === 0 ? 0 : cents; // normaliza -0
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlSigned = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  signDisplay: 'exceptZero',
});

/** Formata centavos como "R$ 1.234,56". */
export function formatBRL(cents: Cents, opts: { signed?: boolean } = {}): string {
  const v = fromCents(cents);
  // Intl usa espaço não separável; normalizamos para espaço comum (estável em testes e cópia).
  return (opts.signed ? brlSigned : brl).format(v).replace(/ /g, ' ');
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}

export function absCents(c: Cents): Cents {
  return Math.abs(c);
}
