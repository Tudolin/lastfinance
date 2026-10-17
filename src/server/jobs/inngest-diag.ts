import 'server-only';

type Env = Record<string, string | undefined>;

export type KeyInfo = {
  present: boolean;
  length: number;
  /** Prefixo público (ex.: "signkey-prod-"); nunca parte do segredo. */
  prefix: string | null;
  /** Últimos 4 caracteres, para comparar com o painel do Inngest. */
  last4: string | null;
  /** Espaço ou quebra de linha no começo/fim do valor. */
  untrimmed: boolean;
};

export function keyInfo(raw: string | undefined): KeyInfo {
  if (!raw) return { present: false, length: 0, prefix: null, last4: null, untrimmed: false };
  const v = raw.trim();
  return {
    present: true,
    length: v.length,
    prefix: /^signkey-[a-z]+-/i.exec(v)?.[0] ?? null,
    last4: v.length >= 12 ? v.slice(-4) : null,
    untrimmed: v !== raw,
  };
}

/**
 * Como o SDK do Inngest vai se comportar neste deploy, sem expor segredos: de onde lê as chaves,
 * qual ambiente manda no header `x-inngest-env` e para qual URL envia eventos.
 */
export function inngestDiagnostics(env: Env = process.env) {
  return {
    deploy: {
      vercelEnv: env.VERCEL_ENV ?? null,
      branch: env.VERCEL_GIT_COMMIT_REF ?? null,
      commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    eventKey: keyInfo(env.INNGEST_EVENT_KEY),
    signingKey: keyInfo(env.INNGEST_SIGNING_KEY),
    signingKeyFallback: keyInfo(env.INNGEST_SIGNING_KEY_FALLBACK),
    // Mesma ordem do SDK (helpers/env.js → getEnvironmentName).
    envHeader: env.INNGEST_ENV || env.BRANCH_NAME || env.VERCEL_GIT_COMMIT_REF || null,
    eventApi: env.INNGEST_EVENT_API_BASE_URL || env.INNGEST_BASE_URL || 'https://inn.gs (padrão)',
    overrides: [
      'INNGEST_ENV',
      'INNGEST_BASE_URL',
      'INNGEST_EVENT_API_BASE_URL',
      'INNGEST_API_BASE_URL',
      'INNGEST_DEV',
    ].filter((k) => env[k] !== undefined),
  };
}
export type InngestDiagnostics = ReturnType<typeof inngestDiagnostics>;
