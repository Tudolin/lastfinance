import { describe, expect, it } from 'vitest';
import { pjNet, simplesEffectiveRate } from './pj';
import { defaultTaxTables } from './tables';

const T = defaultTaxTables();

describe('PJ', () => {
  it('MEI de serviços: DAS fixo de 5% do mínimo + ISS', () => {
    const r = pjNet(500000, { regime: 'mei' }, T);
    expect(r.companyTaxes).toBe(8105 + 500); // 81,05 + 5,00
    expect(r.net).toBe(500000 - 8605);
  });

  it('Simples: fator R ≥ 28% → Anexo III; abaixo → Anexo V', () => {
    const iii = pjNet(
      1000000,
      { regime: 'simples', simplesAnnex: 'fator_r', proLabore: 300000 },
      T,
    );
    expect(iii.annex).toBe('iii');
    expect(iii.fatorR).toBeGreaterThanOrEqual(0.28);
    expect(iii.companyTaxes).toBe(60000); // RBT12 120 mil → 1ª faixa, 6%

    const v = pjNet(1000000, { regime: 'simples', simplesAnnex: 'fator_r', proLabore: 150000 }, T);
    expect(v.annex).toBe('v');
    expect(v.companyTaxes).toBe(155000); // 15,5%
  });

  it('alíquota efetiva do Simples na 2ª faixa', () => {
    // RBT12 300 mil, Anexo III: (300.000 × 11,2% − 9.360) / 300.000 = 8,08%
    expect(simplesEffectiveRate(30000000, T.simples_annex_iii.brackets)).toBeCloseTo(0.0808, 6);
  });

  it('Presumido de serviços: 11,33% + ISS + INSS patronal do pró-labore', () => {
    const r = pjNet(2000000, { regime: 'presumido', issRate: 0.02, proLabore: 162100 }, T);
    expect(r.companyTaxes).toBe(226600 + 40000); // 11,33% + 2% ISS
    expect(r.proLaboreEmployerInss).toBe(32420);
    expect(r.proLaboreInss).toBe(17831); // 11%
    expect(r.distribution).toBe(2000000 - 266600 - 162100 - 32420);
  });

  it('dividendos acima de R$ 50 mil no mês sofrem retenção de 10%', () => {
    const r = pjNet(10000000, { regime: 'manual', manualRate: 0.1 }, T);
    expect(r.distribution).toBe(9000000);
    expect(r.dividendsWithholding).toBe(900000);
    expect(r.net).toBe(8100000);
  });

  it('as linhas somam o líquido', () => {
    for (const cfg of [
      { regime: 'mei' as const },
      { regime: 'simples' as const, proLabore: 300000, monthlyCosts: 30000 },
      { regime: 'presumido' as const, proLabore: 300000, issRate: 0.05 },
      { regime: 'manual' as const, manualRate: 0.15, proLabore: 200000 },
    ]) {
      const r = pjNet(1500000, cfg, T);
      const sum = r.lines.reduce((s, l) => s + l.cents, 0);
      expect(sum).toBe(r.net);
    }
  });
});
