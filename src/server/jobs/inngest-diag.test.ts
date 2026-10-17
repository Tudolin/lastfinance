import { describe, expect, it } from 'vitest';
import { inngestDiagnostics, keyInfo } from './inngest-diag';

describe('keyInfo', () => {
  it('mostra só prefixo público, tamanho e final', () => {
    const k = keyInfo('signkey-prod-0123456789abcdef');
    expect(k).toEqual({
      present: true,
      length: 29,
      prefix: 'signkey-prod-',
      last4: 'cdef',
      untrimmed: false,
    });
  });

  it('acusa espaço ou quebra de linha', () => {
    expect(keyInfo('abcdefghijklmnop\n').untrimmed).toBe(true);
  });

  it('ausente', () => {
    expect(keyInfo(undefined).present).toBe(false);
  });
});

describe('inngestDiagnostics', () => {
  it('resolve o ambiente como o SDK (branch da Vercel)', () => {
    const d = inngestDiagnostics({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' });
    expect(d.envHeader).toBe('main');
    expect(d.overrides).toEqual([]);
  });

  it('lista variáveis que mudam o destino', () => {
    const d = inngestDiagnostics({ INNGEST_ENV: 'x', INNGEST_DEV: '0' });
    expect(d.envHeader).toBe('x');
    expect(d.overrides).toEqual(['INNGEST_ENV', 'INNGEST_DEV']);
  });
});
