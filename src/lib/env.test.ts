import { describe, expect, it } from 'vitest';
import { checkEnv } from './env';

const ok = {
  DATABASE_URL: 'postgres://u:p@host/db',
  SESSION_SECRET: 'x'.repeat(40),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('checkEnv', () => {
  it('aceita o mínimo obrigatório', () => {
    expect(checkEnv(ok)).toEqual([]);
  });

  it('lista o que falta, com dica, sem expor valores', () => {
    const problems = checkEnv({
      DATABASE_URL: ok.DATABASE_URL,
      DATA_ENCRYPTION_KEY: 'curta-demais-segredo',
    });
    expect(problems).toEqual([
      expect.stringMatching(/^SESSION_SECRET: não definida — gere com/),
      expect.stringMatching(/^DATA_ENCRYPTION_KEY: DATA_ENCRYPTION_KEY: 32 bytes em base64/),
    ]);
    expect(problems.join(' ')).not.toContain('curta-demais-segredo');
    expect(problems.join(' ')).not.toContain('u:p@host');
  });

  it('em produção na Vercel, exige as chaves do Inngest (a não ser com JOBS_MODE=inline)', () => {
    const prod = { ...ok, VERCEL_ENV: 'production' };
    expect(checkEnv(prod)).toEqual([
      expect.stringMatching(/^INNGEST_EVENT_KEY: não definida — conecte a integração Inngest/),
      expect.stringMatching(/^INNGEST_SIGNING_KEY: não definida/),
    ]);
    expect(checkEnv({ ...prod, INNGEST_EVENT_KEY: 'k', INNGEST_SIGNING_KEY: 's' })).toEqual([]);
    expect(checkEnv({ ...prod, JOBS_MODE: 'inline' })).toEqual([]);
    expect(checkEnv({ ...ok, VERCEL_ENV: 'preview' })).toEqual([]);
  });
});
