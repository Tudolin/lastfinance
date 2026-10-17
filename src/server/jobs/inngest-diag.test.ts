import { describe, expect, it } from 'vitest';
import { inngestDiagnostics, keyInfo, probeEventApi, stripsBranchEnvHeader } from './inngest-diag';

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

describe('stripsBranchEnvHeader', () => {
  it('remove o header de branch na produção da Vercel', () => {
    expect(stripsBranchEnvHeader({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' })).toBe(
      true,
    );
  });
  it('respeita INNGEST_ENV explícito e previews', () => {
    expect(stripsBranchEnvHeader({ VERCEL_ENV: 'production', INNGEST_ENV: 'prod' })).toBe(false);
    expect(stripsBranchEnvHeader({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat' })).toBe(
      false,
    );
  });
});

describe('probeEventApi', () => {
  it('testa com e sem o header e devolve o error_code real', async () => {
    const calls: { url: string; env: string | null }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const env = (init.headers as Record<string, string>)['x-inngest-env'] ?? null;
      calls.push({ url, env });
      return env
        ? new Response(JSON.stringify({ error: 'x', error_code: 'env_not_found' }), { status: 404 })
        : new Response(JSON.stringify({ ids: ['1'], status: 200 }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await probeEventApi(
      { INNGEST_EVENT_KEY: ' abc ', VERCEL_GIT_COMMIT_REF: 'main' },
      fakeFetch,
    );
    expect(calls.map((c) => c.url)).toEqual(['https://inn.gs/e/abc', 'https://inn.gs/e/abc']);
    expect(r).toEqual([
      { envHeader: 'main', status: 404, error: 'env_not_found' },
      { envHeader: null, status: 200, error: null },
    ]);
  });
  it('sem chave não chama nada', async () => {
    expect(
      await probeEventApi({}, (() => {
        throw new Error('não devia chamar');
      }) as unknown as typeof fetch),
    ).toEqual([]);
  });
});
