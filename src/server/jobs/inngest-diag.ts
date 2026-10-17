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
/**
 * Na produção da Vercel o SDK manda `x-inngest-env: <branch>` (de VERCEL_GIT_COMMIT_REF). Esse header só
 * serve para ambientes de branch do Inngest; com as chaves de Production ele faz o Inngest procurar um
 * ambiente "main" que não existe e o envio volta 404. Sem INNGEST_ENV explícito, o app não manda.
 */
export function stripsBranchEnvHeader(env: Env = process.env) {
  return env.VERCEL_ENV === 'production' && !env.INNGEST_ENV?.trim();
}

export function inngestDiagnostics(env: Env = process.env) {
  return {
    envHeaderStripped: stripsBranchEnvHeader(env),
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

export type ProbeResult = {
  /** Valor do header `x-inngest-env` usado, ou null quando o envio foi feito sem ele. */
  envHeader: string | null;
  status: number | null;
  /** `error_code`/`error` que o Inngest devolveu (nunca contém a chave). */
  error: string | null;
};

/**
 * Manda um evento de teste direto na API de eventos, com e sem `x-inngest-env`, e devolve o que o
 * Inngest respondeu de verdade. O SDK troca a resposta de erro por uma frase genérica ("Event key not
 * found" para qualquer 404), o que esconde se o problema é a chave ou o ambiente.
 */
export async function probeEventApi(
  env: Env = process.env,
  doFetch: typeof fetch = fetch,
): Promise<ProbeResult[]> {
  const key = env.INNGEST_EVENT_KEY?.trim();
  if (!key) return [];
  const base = (env.INNGEST_EVENT_API_BASE_URL || env.INNGEST_BASE_URL || 'https://inn.gs').replace(
    /\/+$/,
    '',
  );
  const branch = inngestDiagnostics(env).envHeader;
  const variants = branch ? [branch, null] : [null];
  return Promise.all(
    variants.map(async (envHeader): Promise<ProbeResult> => {
      try {
        const res = await doFetch(`${base}/e/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(envHeader ? { 'x-inngest-env': envHeader } : {}),
          },
          body: JSON.stringify({ name: 'app/diag.ping', data: {} }),
        });
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          error_code?: string;
        } | null;
        const error = res.ok ? null : body?.error_code || body?.error || null;
        return { envHeader, status: res.status, error };
      } catch {
        return { envHeader, status: null, error: 'network' };
      }
    }),
  );
}
