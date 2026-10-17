/**
 * Taxa interna de retorno por período de uma série de fluxos igualmente espaçados (`flows[0]` em
 * t=0). Newton–Raphson a partir de `guess`; se não convergir, bisseção em [-99%, 1000%].
 * Devolve null quando não há troca de sinal (sem solução).
 */
export function irr(flows: readonly number[], guess = 0.01): number | null {
  const npv = (r: number) => flows.reduce((s, f, t) => s + f / (1 + r) ** t, 0);
  const dnpv = (r: number) => flows.reduce((s, f, t) => s - (t * f) / (1 + r) ** (t + 1), 0);
  if (!flows.some((f) => f > 0) || !flows.some((f) => f < 0)) return null;

  let r = guess;
  for (let i = 0; i < 100; i++) {
    const v = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (!Number.isFinite(next) || next <= -0.99) break;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }

  let lo = -0.99;
  let hi = 10;
  let flo = npv(lo);
  if (flo * npv(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-13) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}
